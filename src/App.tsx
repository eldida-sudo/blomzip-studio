import { useEffect, useMemo, useRef, useState } from "react";
import { initialImages, type ImageItem } from "./data/demoImages";
import { EntryReview } from "./components/EntryReview";
import { MockObservationEngine, type ObservationEngine } from "./components/observationEngine";
import { ZipImportPanel } from "./components/ZipImportPanel";
import type {
  DraftVisit,
  DraftWorkspace,
  Entry,
  EntrySuggestionCategory,
  ImageRecord,
  Observation,
  Visit,
} from "./models/blomzip";
import {
  createArchiveStateSnapshot,
  loadArchiveState,
  saveArchiveState,
} from "./utils/archivePersistence";
import {
  createDraftImportSummary,
  createDraftVisitFromState,
  loadDraftWorkspace,
  saveDraftWorkspace,
  upsertDraftVisit,
} from "./utils/draftWorkspace";
import { discoverPlacesVisionSummary } from "./utils/discoverPlacesVisionEngine";
import { mergeImportedVisit } from "./utils/mergeImportedVisit";
import { createPublishReadyVisitOutput } from "./utils/publishReadyOutput";
import type { ZipImportSummary } from "./utils/readZipImages";
import "./App.css";

type ViewFilter = "all" | "favorites" | "hero";

type SuggestionFilter = "all" | EntrySuggestionCategory;

interface BatchImportFeedback {
  fileName: string;
  addedPhotographs: number;
  totalPhotographs: number;
  totalBatches: number;
}

type ReviewQueueMode = "story-first" | "needs-confirmation";

interface InboxSuggestionItem {
  entryId: string;
  index: number;
  filename: string;
  confidence?: number;
}

interface InboxSuggestionGroup {
  key: string;
  title: string;
  items: InboxSuggestionItem[];
}

type PrimaryArchiveAction =
  | "import"
  | "review-ai"
  | "review"
  | "story"
  | "finalize"
  | "publish";

type TimelineRow =
  | {
      type: "header";
      dateKey: string;
      label: string;
    }
  | {
      type: "card";
      item: {
        image: ImageItem;
        index: number;
        entry: Entry | undefined;
        imageRecord: ImageRecord | undefined;
      };
    };

const SUGGESTION_FILTER_OPTIONS: Array<{ value: SuggestionFilter; label: string }> = [
  { value: "all", label: "All AI categories" },
  { value: "story-candidate", label: "Story candidates" },
  { value: "hero-candidate", label: "Hero candidates" },
  { value: "favorite-candidate", label: "Favorite candidates" },
  { value: "strong-change", label: "Strong change / comparison value" },
  { value: "overview-image", label: "Overview images" },
  { value: "detail-image", label: "Detail images" },
  { value: "by-place", label: "By place" },
  { value: "needs-review", label: "Needs review" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "possible-duplicates", label: "Possible duplicates" },
];

function getSuggestionChipLabel(category: EntrySuggestionCategory): string {
  switch (category) {
    case "story-candidate":
      return "AI: Story";
    case "hero-candidate":
      return "AI: Hero";
    case "favorite-candidate":
      return "AI: Favorite";
    case "strong-change":
      return "AI: Change";
    case "overview-image":
      return "AI: Overview";
    case "detail-image":
      return "AI: Detail";
    case "by-place":
      return "AI: Place";
    case "needs-review":
      return "AI: Needs review";
    case "low-confidence":
      return "AI: Low confidence";
    case "possible-duplicates":
      return "AI: Duplicate";
    default:
      return "AI";
  }
}

function getPossibleDuplicateEntryIdsByRecord(imageRecords: ImageRecord[] | undefined): Map<string, string[]> {
  const duplicatesByRecordId = new Map<string, string[]>();

  if (!imageRecords || imageRecords.length < 2) {
    return duplicatesByRecordId;
  }

  const groups = new Map<string, string[]>();

  imageRecords.forEach((record) => {
    const width = record.width ?? 0;
    const height = record.height ?? 0;
    const sizeBucket = Math.round(record.fileSize / 1024);
    const key = `${record.format}-${width}x${height}-${sizeBucket}`;
    const group = groups.get(key) ?? [];
    group.push(record.id);
    groups.set(key, group);
  });

  groups.forEach((recordIds) => {
    if (recordIds.length < 2) {
      return;
    }

    recordIds.forEach((recordId) => {
      duplicatesByRecordId.set(
        recordId,
        recordIds.filter((candidateId) => candidateId !== recordId)
      );
    });
  });

  return duplicatesByRecordId;
}

function createAutomaticSuggestions(options: {
  entry: Entry;
  imageRecord: ImageRecord | undefined;
  observations: Observation[];
  possibleDuplicateEntryIds: string[];
}) {
  const { entry, imageRecord, observations, possibleDuplicateEntryIds } = options;
  const confidenceValues = observations
    .map((observation) => observation.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  const confidence = confidenceValues.length > 0
    ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
    : 0.6;

  const hasChangeSignal = observations.some((observation) => observation.type.toLowerCase().includes("change"));
  const categories = new Set<EntrySuggestionCategory>();

  if (confidence >= 0.7) {
    categories.add("story-candidate");
    categories.add("favorite-candidate");
  }

  if (confidence >= 0.85) {
    categories.add("hero-candidate");
  }

  if (hasChangeSignal) {
    categories.add("strong-change");
  }

  if (imageRecord?.orientation === "landscape") {
    categories.add("overview-image");
  } else {
    categories.add("detail-image");
  }

  if ((imageRecord?.sourcePath ?? "").includes("/")) {
    categories.add("by-place");
  }

  if (!entry.reviewed) {
    categories.add("needs-review");
  }

  if (confidence < 0.75) {
    categories.add("low-confidence");
  }

  if (possibleDuplicateEntryIds.length > 0) {
    categories.add("possible-duplicates");
  }

  return {
    engine: "mock-observation-engine" as const,
    generatedAt: new Date().toISOString(),
    confidence,
    categories: Array.from(categories),
    possibleDuplicateEntryIds: possibleDuplicateEntryIds.length > 0 ? possibleDuplicateEntryIds : undefined,
  };
}

function withAutomaticAnalysisSuggestions(visit: Visit, observationEngine: ObservationEngine): Visit {
  const imageRecordsById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));
  const duplicateRecordIds = getPossibleDuplicateEntryIdsByRecord(visit.imageRecords);
  const entryIdByRecordId = new Map(visit.entries.map((entry) => [entry.imageRecordId, entry.id]));

  return {
    ...visit,
    entries: visit.entries.map((entry) => {
      const imageRecord = imageRecordsById.get(entry.imageRecordId);
      const observations = entry.observations.length > 0 ? entry.observations : observationEngine.generateObservations(entry.id);

      if (entry.analysisSuggestions) {
        return {
          ...entry,
          observations,
        };
      }

      const possibleDuplicateEntryIds = (duplicateRecordIds.get(entry.imageRecordId) ?? [])
        .map((recordId) => entryIdByRecordId.get(recordId))
        .filter((entryId): entryId is string => Boolean(entryId));

      return {
        ...entry,
        observations,
        analysisSuggestions: createAutomaticSuggestions({
          entry,
          imageRecord,
          observations,
          possibleDuplicateEntryIds,
        }),
      };
    }),
  };
}

function createDraftGalleryImage(options: {
  visit: Visit;
  entry: Entry;
  imageRecord: ImageRecord | undefined;
  importBatchFileName: string | undefined;
  index: number;
}): ImageItem {
  const { visit, entry, imageRecord, importBatchFileName, index } = options;
  const filename = imageRecord?.filename ?? `entry-${index + 1}`;

  return {
    id: index + 1,
    title: filename,
    collection: "Imported ZIP",
    date: visit.date,
    tags: [...entry.tags],
    favorite: Boolean(entry.favorite),
    hero: Boolean(entry.hero),
    notes: entry.notes,
    color: "linear-gradient(135deg, #6a7878, #d6d6c8)",
    src: imageRecord?.thumbnailUrl ?? "",
    alt: filename,
    storyRole: entry.storySelected ? "Selected for Courtyard Story" : entry.reviewed ? "Reviewed import entry" : "Pending import entry",
    season: "Imported",
    location: imageRecord?.sourcePath ?? "Imported visit",
    mood: "",
    material: "",
    light: "",
    composition: "",
    importSource: importBatchFileName ? `ZIP import (${importBatchFileName})` : `ZIP import (${visit.id})`,
  };
}

function createGalleryImagesFromVisit(visit: Visit): ImageItem[] {
  const imageRecordsById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));
  const importBatchesById = new Map((visit.importBatches ?? []).map((batch) => [batch.id, batch]));

  return visit.entries.map((entry, index) =>
    createDraftGalleryImage({
      visit,
      entry,
      imageRecord: imageRecordsById.get(entry.imageRecordId),
      importBatchFileName: importBatchesById.get(imageRecordsById.get(entry.imageRecordId)?.importBatchId ?? "")?.fileName,
      index,
    })
  );
}

function formatDateLabel(value: string | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(minDate: string | undefined, maxDate: string | undefined): string {
  if (!minDate || !maxDate) {
    return "Undated";
  }

  if (minDate === maxDate) {
    return formatDateLabel(minDate);
  }

  return `${formatDateLabel(minDate)} - ${formatDateLabel(maxDate)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getDateKeyFromCaptureDate(captureDate?: string): string {
  if (!captureDate) {
    return "undated";
  }

  const parsed = Date.parse(captureDate);
  if (Number.isNaN(parsed)) {
    return "undated";
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function getDateHeaderLabel(dateKey: string): string {
  if (dateKey === "undated") {
    return "Undated";
  }

  return formatDateLabel(dateKey);
}

function mapSuggestionCategoryLabel(category: EntrySuggestionCategory): string {
  switch (category) {
    case "story-candidate":
      return "story";
    case "hero-candidate":
      return "hero";
    case "favorite-candidate":
      return "favorite";
    case "possible-duplicates":
      return "duplicate";
    case "by-place":
      return "place";
    case "strong-change":
      return "observation";
    case "overview-image":
      return "overview";
    case "detail-image":
      return "detail";
    case "needs-review":
      return "needs review";
    case "low-confidence":
      return "low confidence";
    default:
      return "suggestion";
  }
}

function getQueuePriority(entry: Entry): number {
  const categories = entry.analysisSuggestions?.categories ?? [];

  if (categories.includes("story-candidate")) {
    return 0;
  }

  if (categories.includes("hero-candidate")) {
    return 1;
  }

  if (categories.includes("favorite-candidate")) {
    return 2;
  }

  return 3;
}

function isNormalImagePath(value: string): boolean {
  return Boolean(value) && !value.startsWith("data:") && !value.startsWith("blob:") && !value.startsWith("http://") && !value.startsWith("https://");
}

export function getGalleryCardDisplayTitle(image: ImageItem, imageRecord?: Pick<ImageRecord, "filename"> | null) {
  if (imageRecord?.filename) {
    return imageRecord.filename;
  }

  if (image.title) {
    return image.title;
  }

  const normalizedSrc = image.src?.trim();
  if (normalizedSrc && isNormalImagePath(normalizedSrc)) {
    return normalizedSrc.split("/").filter(Boolean).pop() ?? normalizedSrc;
  }

  return image.title;
}

export function resolveGalleryThumbnailSrc(image: ImageItem, imageRecord?: Pick<ImageRecord, "thumbnailUrl"> | null) {
  const normalizedSrc = image.src?.trim();

  if (normalizedSrc) {
    return normalizedSrc;
  }

  return imageRecord?.thumbnailUrl ?? "";
}

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [suggestionFilter, setSuggestionFilter] = useState<SuggestionFilter>("all");
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [importSummary, setImportSummary] = useState<ZipImportSummary | null>(null);
  const [importVisit, setImportVisit] = useState<Visit | null>(null);
  const [latestImportedBatchIdForVision, setLatestImportedBatchIdForVision] = useState<string | null>(null);
  const [activeBatchFilterId, setActiveBatchFilterId] = useState<string | null>(null);
  const [lastBatchImportFeedback, setLastBatchImportFeedback] = useState<BatchImportFeedback | null>(null);
  const [draftWorkspace, setDraftWorkspace] = useState<DraftWorkspace>(() => loadDraftWorkspace());
  const [isArchiveHydrated, setIsArchiveHydrated] = useState(false);
  const [isReviewingEntries, setIsReviewingEntries] = useState(false);
  const [reviewStartIndex, setReviewStartIndex] = useState(0);
  const [overviewObservationEngine] = useState<ObservationEngine>(() => new MockObservationEngine());
  const hasAppliedStudioImagesRef = useRef(false);
  const sidebarImportSectionRef = useRef<HTMLElement | null>(null);
  const savedDrafts = draftWorkspace.drafts;
  const hasExportableArchive = Boolean(importVisit || savedDrafts.length > 0);

  useEffect(() => {
    let isCancelled = false;

    void loadArchiveState().then((snapshot) => {
      if (isCancelled) {
        return;
      }

      if (snapshot) {
        setImportVisit(snapshot.importVisit);
        setDraftWorkspace(snapshot.draftWorkspace);
      }

      setIsArchiveHydrated(true);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isArchiveHydrated) {
      return;
    }

    saveDraftWorkspace(draftWorkspace);
  }, [draftWorkspace, isArchiveHydrated]);

  useEffect(() => {
    if (!isArchiveHydrated) {
      return;
    }

    if (!hasExportableArchive) {
      return;
    }

    void saveArchiveState(createArchiveStateSnapshot({ importVisit, draftWorkspace }));
  }, [draftWorkspace, hasExportableArchive, importVisit, isArchiveHydrated]);

  function handleImportEntryUpdated(updatedEntry: Entry) {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      return {
        ...currentVisit,
        status: currentVisit.status === "Finalized" ? currentVisit.status : "Review in progress",
        entries: currentVisit.entries.map((entry) =>
          entry.id === updatedEntry.id ? updatedEntry : entry
        ),
      };
    });
  }

  function handleStorySelectionFromOverview(index: number) {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      const targetEntry = currentVisit.entries[index];
      if (!targetEntry) {
        return currentVisit;
      }

      const storySelected = !targetEntry.storySelected;

      return {
        ...currentVisit,
        status: currentVisit.status === "Finalized" ? currentVisit.status : "Review in progress",
        entries: currentVisit.entries.map((entryItem, entryIndex) =>
          entryIndex === index
            ? {
                ...entryItem,
                storySelected,
                updatedAt: new Date().toISOString(),
              }
            : entryItem
        ),
      };
    });
  }

  function handleVisitFinalized(finalizedVisit: Visit) {
    setImportVisit(finalizedVisit);
    setIsReviewingEntries(false);
  }

  function handleSaveDraft() {
    if (!importVisit) {
      return;
    }

    const draftImages = createGalleryImagesFromVisit(importVisit);

    const draftVisit = createDraftVisitFromState({
      visit: {
        ...importVisit,
        status: importVisit.status === "Finalized" ? "Finalized" : "Review in progress",
      },
      studioImages: draftImages,
    });

    setDraftWorkspace((currentWorkspace) => upsertDraftVisit(currentWorkspace, draftVisit));
  }

  function handleLoadDraft(draftVisit: DraftVisit) {
    hasAppliedStudioImagesRef.current = true;
    setImages(draftVisit.studioImages);
    setImportSummary(createDraftImportSummary(draftVisit));
    setImportVisit(withAutomaticAnalysisSuggestions(draftVisit.visit, overviewObservationEngine));
    setLatestImportedBatchIdForVision(null);
    setReviewStartIndex(0);
    setIsReviewingEntries(true);
    setSelectedImage(null);
    setDraftWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      activeDraftId: draftVisit.id,
    }));
  }

  useEffect(() => {
    fetch("/data/images.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load imported images");
        return response.json();
      })
      .then((data: ImageItem[]) => {
        if (hasAppliedStudioImagesRef.current) {
          return;
        }

        setImages(data);
        hasAppliedStudioImagesRef.current = true;
      })
      .catch(() => {
        if (hasAppliedStudioImagesRef.current) {
          return;
        }

        setImages(initialImages);
        hasAppliedStudioImagesRef.current = true;
      });
  }, []);

  const gallerySourceImages = useMemo(
    () => (importVisit ? createGalleryImagesFromVisit(importVisit) : images),
    [importVisit, images]
  );

  const imageRecordsById = useMemo(
    () => new Map((importVisit?.imageRecords ?? []).map((record) => [record.id, record])),
    [importVisit]
  );

  const importBatchesById = useMemo(
    () => new Map((importVisit?.importBatches ?? []).map((batch) => [batch.id, batch])),
    [importVisit]
  );

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(gallerySourceImages.map((image) => image.collection)))];
  }, [gallerySourceImages]);

  const galleryItems = useMemo(
    () => gallerySourceImages.map((image, index) => {
      const entry = importVisit?.entries[index];
      const imageRecord = entry ? imageRecordsById.get(entry.imageRecordId) : undefined;

      return {
        image,
        index,
        entry,
        imageRecord,
        importBatch: imageRecord?.importBatchId ? importBatchesById.get(imageRecord.importBatchId) : undefined,
      };
    }),
    [gallerySourceImages, importVisit, imageRecordsById, importBatchesById]
  );

  const filteredImages = galleryItems.filter(({ image, entry, imageRecord }) => {
    const searchText =
      `${image.title} ${image.collection} ${image.tags.join(" ")} ${image.notes} ${image.storyRole} ${image.season} ${image.location} ${image.mood} ${image.material} ${image.light} ${image.composition} ${image.importSource}`.toLowerCase();

    const matchesSearch = searchText.includes(search.toLowerCase());
    const matchesCollection =
      collectionFilter === "All" || image.collection === collectionFilter;

    const matchesViewFilter =
      viewFilter === "all" ||
      (viewFilter === "favorites" && image.favorite) ||
      (viewFilter === "hero" && image.hero);

    const entrySuggestionCategories = entry?.analysisSuggestions?.categories ?? [];
    const matchesSuggestionFilter =
      suggestionFilter === "all" || entrySuggestionCategories.includes(suggestionFilter);

    const matchesBatchFilter = !activeBatchFilterId || imageRecord?.importBatchId === activeBatchFilterId;

    return matchesSearch && matchesCollection && matchesViewFilter && matchesSuggestionFilter && matchesBatchFilter;
  });

  const archiveDateRange = useMemo(() => {
    if (!importVisit?.imageRecords || importVisit.imageRecords.length === 0) {
      return "No dated captures yet";
    }

    const datedValues = importVisit.imageRecords
      .map((record) => {
        const parsed = record.captureDate ? Date.parse(record.captureDate) : Number.NaN;
        return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
      })
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right));

    if (datedValues.length === 0) {
      return "No dated captures yet";
    }

    return formatDateRange(datedValues[0], datedValues[datedValues.length - 1]);
  }, [importVisit]);

  const archiveStats = useMemo(() => {
    const entries = importVisit?.entries ?? [];
    const totalPhotographs = importVisit?.imageRecords?.length ?? gallerySourceImages.length;
    const importBatchCount = importVisit?.importBatches?.length ?? 0;
    const storySelected = entries.filter((entry) => entry.storySelected).length;
    const heroImages = entries.filter((entry) => entry.hero).length;
    const favoriteImages = entries.filter((entry) => entry.favorite).length;
    const waitingReview = entries.filter((entry) => !entry.reviewed).length;
    const aiSuggestionsWaiting = entries.filter(
      (entry) => Boolean(entry.analysisSuggestions) && !entry.reviewed
    ).length;

    return {
      totalPhotographs,
      importBatchCount,
      storySelected,
      heroImages,
      favoriteImages,
      waitingReview,
      aiSuggestionsWaiting,
    };
  }, [importVisit, gallerySourceImages.length]);

  const batchOverview = useMemo(() => {
    if (!importVisit?.importBatches) {
      return [];
    }

    const entryByImageRecordId = new Map(importVisit.entries.map((entry) => [entry.imageRecordId, entry]));

    return [...importVisit.importBatches]
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt))
      .map((batch) => {
        const records = (importVisit.imageRecords ?? []).filter((record) => record.importBatchId === batch.id);
        const datedValues = records
          .map((record) => {
            const parsed = record.captureDate ? Date.parse(record.captureDate) : Number.NaN;
            return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
          })
          .filter((value): value is string => value !== null)
          .sort((left, right) => left.localeCompare(right));
        const reviewedCount = records.filter((record) => entryByImageRecordId.get(record.id)?.reviewed).length;
        const totalCount = records.length;
        const reviewPercent = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0;

        return {
          batch,
          captureRange: formatDateRange(datedValues[0], datedValues[datedValues.length - 1]),
          reviewedCount,
          totalCount,
          reviewPercent,
        };
      });
  }, [importVisit]);

  const timelineItems = useMemo(() => {
    let lastDateKey: string | null = null;

    return filteredImages.flatMap((item): TimelineRow[] => {
      const dateKey = getDateKeyFromCaptureDate(item.imageRecord?.captureDate);
      const row: TimelineRow[] = [{ type: "card", item }];

      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        row.unshift({
          type: "header",
          dateKey,
          label: getDateHeaderLabel(dateKey),
        });
      }

      return row;
    });
  }, [filteredImages]);

  const reviewedEntryCount = importVisit?.entries.filter((entry) => entry.reviewed).length ?? 0;
  const storySelectedEntryCount = importVisit?.entries.filter((entry) => entry.storySelected).length ?? 0;
  const totalImportedEntries = importVisit?.entries.length ?? 0;
  const isEntryReviewMode = Boolean(isReviewingEntries && importVisit);
  const latestImportBatch = importVisit?.importBatches?.[importVisit.importBatches.length - 1] ?? null;
  const activeGalleryImageId = selectedImage?.id ?? (!isReviewingEntries && importVisit ? gallerySourceImages[reviewStartIndex]?.id : null);
  const canFinalizeVisit = totalImportedEntries > 0 && reviewedEntryCount === totalImportedEntries;
  const isVisitFinalized = importVisit?.status === "Finalized";

  const entryViewModels = useMemo(() => {
    if (!importVisit) {
      return [];
    }

    return importVisit.entries.map((entry, index) => {
      const imageRecord = imageRecordsById.get(entry.imageRecordId);

      return {
        entry,
        index,
        imageRecord,
        filename: imageRecord?.filename ?? `Image ${index + 1}`,
      };
    });
  }, [importVisit, imageRecordsById]);

  const aiInboxGroups = useMemo<InboxSuggestionGroup[]>(() => {
    const groupDefinitions: Array<{
      key: string;
      title: string;
      matches: (entry: Entry) => boolean;
    }> = [
      {
        key: "story-candidates",
        title: "Story candidates",
        matches: (entry) => entry.analysisSuggestions?.categories.includes("story-candidate") ?? false,
      },
      {
        key: "hero-candidates",
        title: "Hero candidates",
        matches: (entry) => entry.analysisSuggestions?.categories.includes("hero-candidate") ?? false,
      },
      {
        key: "favorite-candidates",
        title: "Favorite candidates",
        matches: (entry) => entry.analysisSuggestions?.categories.includes("favorite-candidate") ?? false,
      },
      {
        key: "possible-duplicates",
        title: "Possible duplicates",
        matches: (entry) => entry.analysisSuggestions?.categories.includes("possible-duplicates") ?? false,
      },
      {
        key: "place-suggestions",
        title: "Place suggestions",
        matches: (entry) => entry.analysisSuggestions?.categories.includes("by-place") ?? false,
      },
      {
        key: "observation-suggestions",
        title: "Observation suggestions",
        matches: (entry) =>
          entry.analysisSuggestions?.categories.some((category) =>
            ["strong-change", "overview-image", "detail-image"].includes(category)
          ) ?? false,
      },
    ];

    return groupDefinitions
      .map((definition) => {
        const items = entryViewModels
          .filter(({ entry }) => definition.matches(entry))
          .map(({ entry, index, filename }) => ({
            entryId: entry.id,
            index,
            filename,
            confidence: entry.analysisSuggestions?.confidence,
          }));

        return {
          key: definition.key,
          title: definition.title,
          items,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [entryViewModels]);

  const visionDiscoverySummary = useMemo(() => {
    if (!importVisit) {
      return null;
    }

    return discoverPlacesVisionSummary(importVisit, {
      importBatchId: latestImportedBatchIdForVision,
      fallbackToFullArchive: true,
    });
  }, [importVisit, latestImportedBatchIdForVision]);

  const storyFirstQueue = useMemo(() => {
    return entryViewModels
      .filter(({ entry }) => !entry.reviewed)
      .filter(({ entry }) => {
        const categories = entry.analysisSuggestions?.categories ?? [];
        return (
          categories.includes("story-candidate") ||
          categories.includes("hero-candidate") ||
          categories.includes("favorite-candidate")
        );
      })
      .sort((left, right) => {
        const leftPriority = getQueuePriority(left.entry);
        const rightPriority = getQueuePriority(right.entry);

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.index - right.index;
      });
  }, [entryViewModels]);

  const needsConfirmationQueue = useMemo(() => {
    return entryViewModels
      .filter(({ entry }) => !entry.reviewed)
      .filter(({ entry }) => {
        const categories = entry.analysisSuggestions?.categories ?? [];
        return (
          categories.includes("needs-review") ||
          categories.includes("low-confidence") ||
          categories.includes("possible-duplicates")
        );
      })
      .sort((left, right) => left.index - right.index);
  }, [entryViewModels]);

  const firstUnreviewedEntryIndex = useMemo(
    () => importVisit?.entries.findIndex((entry) => !entry.reviewed) ?? -1,
    [importVisit]
  );

  const primaryArchiveAction = useMemo((): { type: PrimaryArchiveAction; label: string; hint: string } => {
    if (!importVisit) {
      return {
        type: "import",
        label: "Import photographs",
        hint: "Start by importing a ZIP archive to create your real archive.",
      };
    }

    if (isVisitFinalized) {
      return {
        type: "publish",
        label: "Download publish-ready output",
        hint: "Your archive review is complete and ready to publish.",
      };
    }

    if (canFinalizeVisit) {
      return {
        type: "finalize",
        label: "Finalize archive review",
        hint: "All entries are reviewed. Finalize before publishing.",
      };
    }

    if (storyFirstQueue.length > 0 && storySelectedEntryCount === 0) {
      return {
        type: "story",
        label: "Select Story candidates",
        hint: "AI has identified Story-worthy images. Start there.",
      };
    }

    if (storyFirstQueue.length > 0 || needsConfirmationQueue.length > 0) {
      return {
        type: "review-ai",
        label: "Review AI suggestions",
        hint: "AI inbox has items waiting for curator confirmation.",
      };
    }

    return {
      type: "review",
      label: "Continue review",
      hint: "Continue reviewing entries to enrich your archive.",
    };
  }, [
    canFinalizeVisit,
    importVisit,
    isVisitFinalized,
    needsConfirmationQueue.length,
    storyFirstQueue.length,
    storySelectedEntryCount,
  ]);

  useEffect(() => {
    if (!activeBatchFilterId || !importVisit?.importBatches?.some((batch) => batch.id === activeBatchFilterId)) {
      setActiveBatchFilterId(null);
    }
  }, [activeBatchFilterId, importVisit]);

  function handleFinalizeImportedVisit() {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      const reviewedCount = currentVisit.entries.filter((entry) => entry.reviewed).length;
      const totalEntries = currentVisit.entries.length;
      const readyToFinalize = totalEntries > 0 && reviewedCount === totalEntries;

      if (!readyToFinalize) {
        return currentVisit;
      }

      return {
        ...currentVisit,
        status: "Finalized",
      };
    });
  }

  function openReviewWithIndex(index: number) {
    setReviewStartIndex(index);
    setIsReviewingEntries(true);
  }

  function startReviewQueue(mode: ReviewQueueMode) {
    const queue = mode === "story-first" ? storyFirstQueue : needsConfirmationQueue;
    if (queue.length === 0) {
      return;
    }

    openReviewWithIndex(queue[0].index);
  }

  function triggerImportFromSidebar() {
    sidebarImportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const importInput = document.getElementById("zip-import-input") as HTMLInputElement | null;
    importInput?.click();
  }

  function handlePrimaryArchiveAction() {
    switch (primaryArchiveAction.type) {
      case "import":
        triggerImportFromSidebar();
        return;
      case "publish":
        handleDownloadPublishReadyOutput();
        return;
      case "finalize":
        handleFinalizeImportedVisit();
        return;
      case "story":
        startReviewQueue("story-first");
        return;
      case "review-ai":
        if (storyFirstQueue.length > 0) {
          startReviewQueue("story-first");
          return;
        }

        startReviewQueue("needs-confirmation");
        return;
      case "review":
      default:
        if (firstUnreviewedEntryIndex >= 0) {
          openReviewWithIndex(firstUnreviewedEntryIndex);
          return;
        }

        openReviewWithIndex(0);
    }
  }

  function handleDownloadPublishReadyOutput() {
    if (!importVisit || !isVisitFinalized) {
      return;
    }

    const output = createPublishReadyVisitOutput(importVisit);
    const outputBlob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const outputUrl = URL.createObjectURL(outputBlob);
    const outputLink = document.createElement("a");
    const sanitizedDate = importVisit.date.replace(/[^0-9-]/g, "-");

    outputLink.href = outputUrl;
    outputLink.download = `visit-${sanitizedDate}-publish-ready.json`;
    document.body.appendChild(outputLink);
    outputLink.click();
    document.body.removeChild(outputLink);
    URL.revokeObjectURL(outputUrl);
  }

  function handleExportArchiveBackup() {
    if (!hasExportableArchive) {
      return;
    }

    const backup = createArchiveStateSnapshot({ importVisit, draftWorkspace });
    const backupBlob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const backupUrl = URL.createObjectURL(backupBlob);
    const backupLink = document.createElement("a");

    backupLink.href = backupUrl;
    backupLink.download = `blomzip-archive-backup-${backup.savedAt.slice(0, 10)}.json`;
    document.body.appendChild(backupLink);
    backupLink.click();
    document.body.removeChild(backupLink);
    URL.revokeObjectURL(backupUrl);
  }

  function getImageFilename(image: ImageItem, imageRecord?: Pick<ImageRecord, "filename"> | null) {
    return getGalleryCardDisplayTitle(image, imageRecord);
  }

  function renderMeta(label: string, value: string) {
    if (!value) {
      return null;
    }

    return (
      <p>
        <strong>{label}:</strong> {value}
      </p>
    );
  }

  function renderGalleryCard({ image, index }: { image: ImageItem; index: number }) {
    const entry = importVisit?.entries[index];
    const imageRecord = entry ? imageRecordsById.get(entry.imageRecordId) : undefined;
    const reviewed = entry?.reviewed;
    const displayTitle = getImageFilename(image, imageRecord);
    const thumbnailSrc = resolveGalleryThumbnailSrc(image, imageRecord);
    const suggestionCategories = entry?.analysisSuggestions?.categories ?? [];
    const captureLabel = imageRecord?.captureDate ? formatDateLabel(imageRecord.captureDate) : importVisit ? formatDateLabel(importVisit.date) : "Demo image";
    const prioritizedSuggestionCategories: EntrySuggestionCategory[] = [
      "story-candidate",
      "hero-candidate",
      "favorite-candidate",
      "strong-change",
      "overview-image",
      "detail-image",
      "by-place",
      "needs-review",
      "low-confidence",
      "possible-duplicates",
    ];
    const visibleSuggestionCategories = prioritizedSuggestionCategories
      .filter((category) => suggestionCategories.includes(category))
      .slice(0, 2);

    return (
      <article
        key={image.id}
        className={`gallery-card ${activeGalleryImageId === image.id ? "is-current" : ""}`}
      >
        <button
          type="button"
          className="gallery-card-button preview-card-button"
          onClick={() => (importVisit ? openReviewWithIndex(index) : setSelectedImage(image))}
          aria-label={`Open ${displayTitle}`}
          aria-pressed={activeGalleryImageId === image.id}
        >
          <div className="gallery-card-thumb">
            {thumbnailSrc ? <img src={thumbnailSrc} alt={image.alt} /> : <span>No preview</span>}
            {image.hero ? <span className="gallery-card-badge gallery-card-badge-top-left">Hero</span> : null}
            {image.favorite ? <span className="gallery-card-badge gallery-card-badge-top-right">Favorite</span> : null}
          </div>

          <div className="gallery-card-body">
            <div className="gallery-card-header">
              <strong>{displayTitle}</strong>
              <span>#{index + 1}</span>
            </div>

            <p className="gallery-card-meta">
              {captureLabel}
              {!importVisit ? (
                <>
                  <span>•</span>
                  Demo collection
                </>
              ) : null}
            </p>

            <div className="gallery-card-statuses">
              {image.favorite ? <span className="gallery-chip">Favorite</span> : null}
              {image.hero ? <span className="gallery-chip">Hero</span> : null}
              {entry?.storySelected ? <span className="gallery-chip active">Story</span> : null}
              {reviewed !== undefined ? (
                <span className={`gallery-chip ${reviewed ? "active" : "muted"}`}>
                  {reviewed ? "Reviewed" : "Pending"}
                </span>
              ) : null}
              {visibleSuggestionCategories.map((category) => (
                <span key={`${entry?.id ?? image.id}-${category}`} className="gallery-chip muted">
                  {getSuggestionChipLabel(category)}
                </span>
              ))}
            </div>
          </div>
        </button>

        {entry ? (
          <div className="gallery-card-action-row">
            <button
              type="button"
              className="gallery-card-story-toggle"
              onClick={() => handleStorySelectionFromOverview(index)}
              aria-pressed={Boolean(entry.storySelected)}
            >
              {entry.storySelected ? "Remove from Story" : "Select for Story"}
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <main className={`studio ${isEntryReviewMode ? "review-mode" : ""}`}>
      <aside className="sidebar">
        {isEntryReviewMode ? (
          <>
            <section className="sidebar-card sidebar-review-focus-card" data-testid="sidebar-review-focus-section">
              <div>
                <p className="eyebrow">Archive context</p>
                <h3>Current review session</h3>
              </div>

              <div className="archive-overview-grid compact">
                <div>
                  <span>Photographs</span>
                  <strong>{archiveStats.totalPhotographs}</strong>
                </div>
                <div>
                  <span>Batches</span>
                  <strong>{archiveStats.importBatchCount}</strong>
                </div>
                <div>
                  <span>Review progress</span>
                  <strong>{reviewedEntryCount}/{totalImportedEntries}</strong>
                </div>
                <div>
                  <span>Story selected</span>
                  <strong>{archiveStats.storySelected}</strong>
                </div>
              </div>
            </section>

            {latestImportBatch ? (
              <section className="sidebar-card sidebar-review-focus-card" data-testid="sidebar-review-batch-section">
                <div>
                  <p className="eyebrow">Batch provenance</p>
                  <h3>{latestImportBatch.fileName}</h3>
                  <p className="result-count">Imported {formatDateLabel(latestImportBatch.importedAt)}</p>
                  <p className="result-count">{latestImportBatch.imageCount} images in this batch.</p>
                </div>
              </section>
            ) : null}

            <section className="sidebar-card sidebar-save-load-card" data-testid="sidebar-drafts-section">
              <div>
                <p className="eyebrow">Draft workspace</p>
                <h3>Save progress</h3>
              </div>

              <div className="collection-stats draft-actions">
                <button type="button" className="secondary-action" onClick={handleSaveDraft} disabled={!importVisit}>
                  Save Draft
                </button>
                <button type="button" className="secondary-action" onClick={handleExportArchiveBackup} disabled={!hasExportableArchive}>
                  Export archive backup
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className={`sidebar-import-shell ${importVisit ? "secondary" : "primary"}`} ref={sidebarImportSectionRef} data-testid="sidebar-import-section">
              <ZipImportPanel
                className="zip-panel"
                onImportStateChange={({ summary, visit }) => {
                  setImportSummary(summary);
                  setImportVisit((currentVisit) => {
                    if (!visit) {
                      return currentVisit;
                    }

                    const analyzedIncomingVisit = withAutomaticAnalysisSuggestions(visit, overviewObservationEngine);
                    const incomingBatchId = analyzedIncomingVisit.importBatches?.[0]?.id ?? null;
                    const mergedVisit = mergeImportedVisit(currentVisit, analyzedIncomingVisit);

                    setLatestImportedBatchIdForVision(incomingBatchId);

                     if (summary?.status === "ready") {
                      setLastBatchImportFeedback({
                        fileName: summary.fileName,
                        addedPhotographs: summary.imageCount,
                        totalPhotographs: mergedVisit?.imageRecords?.length ?? currentVisit?.imageRecords?.length ?? summary.imageCount,
                        totalBatches: mergedVisit?.importBatches?.length ?? currentVisit?.importBatches?.length ?? (summary.imageCount > 0 ? 1 : 0),
                      });
                    }

                    return mergedVisit ? withAutomaticAnalysisSuggestions(mergedVisit, overviewObservationEngine) : mergedVisit;
                  });
                }}
              />

              {importSummary ? (
                <div className="sidebar-card import-summary-mini">
                  <span>ZIP ready</span>
                  <strong>{importSummary.fileName}</strong>
                  <p className="result-count">
                    {importSummary.imageCount} images, {importSummary.status}
                  </p>
                </div>
              ) : null}
            </section>

            {batchOverview.length > 0 ? (
              <section className="sidebar-card archive-batches-card" data-testid="sidebar-batches-section">
                <div className="archive-batches-header">
                  <div>
                    <p className="eyebrow">Import batches</p>
                    <h3>Batch provenance</h3>
                  </div>
                  {activeBatchFilterId ? (
                    <button type="button" className="secondary-action" onClick={() => setActiveBatchFilterId(null)}>
                      Clear filter
                    </button>
                  ) : null}
                </div>

                <div className="batch-list">
                  {batchOverview.map(({ batch, captureRange, reviewedCount, totalCount, reviewPercent }) => (
                    <button
                      key={batch.id}
                      type="button"
                      className={`batch-item ${activeBatchFilterId === batch.id ? "active" : ""}`}
                      onClick={() => setActiveBatchFilterId((current) => (current === batch.id ? null : batch.id))}
                      aria-pressed={activeBatchFilterId === batch.id}
                    >
                      <div className="batch-item-header">
                        <strong>{batch.fileName}</strong>
                        <span>{batch.imageCount} images</span>
                      </div>
                      <p>Imported {formatDateLabel(batch.importedAt)}</p>
                      <p>Capture range: {captureRange}</p>
                      <p>Review progress: {reviewedCount}/{totalCount} ({reviewPercent}%)</p>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="sidebar-card sidebar-save-load-card" data-testid="sidebar-drafts-section">
              <div>
                <p className="eyebrow">Draft workspace</p>
                <h3>Save or load a draft</h3>
                <p className="result-count">
                  Keep the current curation session in browser storage without changing the canonical archive.
                </p>
              </div>

              <div className="collection-stats draft-actions">
                <button type="button" className="secondary-action" onClick={handleSaveDraft} disabled={!importVisit}>
                  Save Draft
                </button>

                <button type="button" className="secondary-action" onClick={handleExportArchiveBackup} disabled={!hasExportableArchive}>
                  Export archive backup
                </button>

                {savedDrafts.length > 0 ? (
                  savedDrafts.map((draftVisit) => (
                    <button
                      key={draftVisit.id}
                      type="button"
                      className={draftWorkspace.activeDraftId === draftVisit.id ? "active" : ""}
                      onClick={() => handleLoadDraft(draftVisit)}
                    >
                      <span>{draftVisit.label}</span>
                      <strong>{draftVisit.visit.entries.length} entries</strong>
                    </button>
                  ))
                ) : (
                  <p className="result-count">No saved drafts yet.</p>
                )}
              </div>
            </section>
          </>
        )}
      </aside>

      <section className="content">
        {isReviewingEntries && importVisit ? (
          <EntryReview
            visit={importVisit}
            initialEntryIndex={reviewStartIndex}
            onClose={() => setIsReviewingEntries(false)}
            onEntryUpdated={handleImportEntryUpdated}
            onVisitFinalized={handleVisitFinalized}
          />
        ) : (
          <div className="gallery-shell">
            <section className="archive-home-summary" data-testid="archive-home-summary">
              <div>
                <p className="eyebrow">{importVisit ? "Archive home" : "Demo mode"}</p>
                <h2>{importVisit ? "Current archive" : "Current archive not loaded"}</h2>
                <p className="result-count">
                  {importVisit
                    ? `${archiveStats.totalPhotographs} photographs across ${archiveStats.importBatchCount} import batches.`
                    : "Demo collection preview is visible and not part of your archive."}
                </p>
              </div>

              <div className="archive-home-stats">
                <div>
                  <span>Total photographs</span>
                  <strong>{archiveStats.totalPhotographs}</strong>
                </div>
                <div>
                  <span>Import batches</span>
                  <strong>{archiveStats.importBatchCount}</strong>
                </div>
                <div>
                  <span>Date range</span>
                  <strong>{archiveDateRange}</strong>
                </div>
                <div>
                  <span>Story selected</span>
                  <strong>{archiveStats.storySelected}</strong>
                </div>
                <div>
                  <span>Review progress</span>
                  <strong>{totalImportedEntries > 0 ? `${reviewedEntryCount}/${totalImportedEntries}` : "No archive entries"}</strong>
                </div>
              </div>
            </section>

            <section className="archive-attention-card" data-testid="archive-next-action">
              <div>
                <p className="eyebrow">Next useful action</p>
                <h3>{primaryArchiveAction.label}</h3>
                <p className="result-count">{primaryArchiveAction.hint}</p>
              </div>

              {visionDiscoverySummary ? (
                <section className="vision-engine-summary" data-testid="vision-engine-summary" aria-live="polite">
                  <div className="vision-engine-summary-header">
                    <p className="eyebrow">Vision Engine v0.1</p>
                    <h4>Discover Places</h4>
                    <p className="result-count">
                      {visionDiscoverySummary.analyzedImageCount} photographs analyzed
                      {visionDiscoverySummary.analysisScope === "import-batch" ? " (latest import)" : " (full archive)"}
                    </p>
                  </div>

                  <p className="result-count">Vision Engine discovered:</p>

                  <ul className="vision-engine-summary-list">
                    <li>{visionDiscoverySummary.candidatePlaceGroupCount} candidate place groups</li>
                    <li>{visionDiscoverySummary.nearDuplicateCount} near duplicates</li>
                    <li>{visionDiscoverySummary.heroCandidateCount} hero candidates</li>
                  </ul>

                  {visionDiscoverySummary.candidatePlaceGroups.length > 0 ? (
                    <div className="vision-engine-groups">
                      {visionDiscoverySummary.candidatePlaceGroups.slice(0, 3).map((group) => {
                        const representativeRecord = imageRecordsById.get(group.representativeImageRecordId);
                        const representativeLabel = representativeRecord?.filename ?? group.representativeImageRecordId;

                        return (
                          <article key={group.id} className="vision-engine-group-item">
                            <div>
                              <strong>{group.imageRecordIds.length} photographs</strong>
                              <p className="result-count">Representative: {representativeLabel}</p>
                            </div>
                            <div>
                              <span>Confidence</span>
                              <strong>{formatPercent(group.confidence)}</strong>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <button type="button" className="primary-action" onClick={handlePrimaryArchiveAction} data-testid="primary-next-action">
                {primaryArchiveAction.label}
              </button>

              {lastBatchImportFeedback ? (
                <div className="import-feedback-inline" aria-live="polite">
                  <p className="result-count">✓ {lastBatchImportFeedback.fileName} imported</p>
                  <p className="result-count">{lastBatchImportFeedback.addedPhotographs} photographs added</p>
                  <p className="result-count">
                    Archive now contains {lastBatchImportFeedback.totalPhotographs} photographs in {lastBatchImportFeedback.totalBatches} batches.
                  </p>
                </div>
              ) : null}

              {importVisit ? (
                <>
                  <div className="review-queue-controls inline">
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => startReviewQueue("story-first")}
                      disabled={storyFirstQueue.length === 0}
                    >
                      Story-first queue ({storyFirstQueue.length})
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => startReviewQueue("needs-confirmation")}
                      disabled={needsConfirmationQueue.length === 0}
                    >
                      Needs confirmation ({needsConfirmationQueue.length})
                    </button>
                  </div>

                  {aiInboxGroups.length > 0 ? (
                    <div className="ai-inbox-groups inline" data-testid="ai-inbox-main">
                      {aiInboxGroups.map((group) => (
                        <div key={group.key} className="ai-group">
                          <div className="ai-group-header">
                            <strong>{group.title}</strong>
                            <span>{group.items.length}</span>
                          </div>

                          <div className="ai-group-items">
                            {group.items.slice(0, 3).map((item) => {
                              const entry = importVisit.entries[item.index];
                              const topCategory = entry?.analysisSuggestions?.categories?.[0];

                              return (
                                <button
                                  key={item.entryId}
                                  type="button"
                                  className="ai-suggestion-item"
                                  onClick={() => openReviewWithIndex(item.index)}
                                >
                                  <span>{item.filename}</span>
                                  <small>
                                    {topCategory ? mapSuggestionCategoryLabel(topCategory) : "suggestion"}
                                    {typeof item.confidence === "number" ? ` • ${Math.round(item.confidence * 100)}%` : ""}
                                  </small>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="result-count" data-testid="demo-collection-label">Demo collection preview (not part of your archive).</p>
              )}

              {activeBatchFilterId ? <p className="result-count">Batch filter is active.</p> : null}
            </section>

            <div className="gallery-toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search filenames, location, collection, tags or notes..."
              />

              <select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}>
                {collections.map((collection) => (
                  <option key={collection} value={collection}>
                    {collection}
                  </option>
                ))}
              </select>

              <select
                value={suggestionFilter}
                onChange={(event) => setSuggestionFilter(event.target.value as SuggestionFilter)}
                aria-label="AI suggestion category filter"
                disabled={!importVisit}
              >
                {SUGGESTION_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="filter-row filter-row-compact" aria-label="Image view filters">
                <button type="button" className={viewFilter === "all" ? "active" : ""} onClick={() => setViewFilter("all")}>
                  All
                </button>

                <button
                  type="button"
                  className={viewFilter === "favorites" ? "active" : ""}
                  onClick={() => setViewFilter("favorites")}
                >
                  Favorites
                </button>

                <button type="button" className={viewFilter === "hero" ? "active" : ""} onClick={() => setViewFilter("hero")}>
                  Hero
                </button>
              </div>
            </div>

            <section className="gallery-grid">
              {timelineItems.map((timelineItem, timelineIndex) => {
                if (timelineItem.type === "header") {
                  return (
                    <div key={`header-${timelineItem.dateKey}-${timelineIndex}`} className="timeline-date-header" role="heading" aria-level={3}>
                      <span>{timelineItem.label}</span>
                    </div>
                  );
                }

                return renderGalleryCard(timelineItem.item);
              })}
            </section>
          </div>
        )}
      </section>

      {selectedImage && (
        <div className="detail-overlay" onClick={() => setSelectedImage(null)}>
          <article className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setSelectedImage(null)}>
              Close
            </button>

            <div className="detail-image">
              <img src={selectedImage.src} alt={selectedImage.alt} />
            </div>

            <div className="detail-body">
              <p className="collection">{selectedImage.collection}</p>
              <h2>{selectedImage.title}</h2>

              <div className="meta-list">
                {renderMeta("Role", selectedImage.storyRole)}
                {renderMeta("Season", selectedImage.season)}
                {renderMeta("Location", selectedImage.location)}
                {renderMeta("Mood", selectedImage.mood)}
                {renderMeta("Light", selectedImage.light)}
                {renderMeta("Material", selectedImage.material)}
                {renderMeta("Composition", selectedImage.composition)}
                {renderMeta("Import", selectedImage.importSource)}
              </div>

              <div className="tag-row">
                {selectedImage.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              {selectedImage.notes && <p className="detail-notes">{selectedImage.notes}</p>}
            </div>
          </article>
        </div>
      )}
    </main>
  );
}

export default App;