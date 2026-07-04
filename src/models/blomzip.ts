export interface Place {
  id: string;
  name: string;
  slug: string;
  description?: string;

  location?: Location;

  visits: Visit[];
  stories?: Story[];
}

export interface Visit {
  id: string;

  placeId: string;

  date: string;

  weather?: Weather;

  entries: Entry[];

  imageCount?: number;
  importedImageFiles?: string[];
  status?: string;
}

export interface Entry {
  id: string;

  timestamp?: string;

  observations: Observation[];

  fieldNotes?: FieldNote[];
}

export interface Observation {
  id: string;

  type: ObservationType;

  title: string;

  description?: string;

  photos?: Photo[];

  tags?: string[];
}

export interface FieldNote {
  id: string;

  text: string;

  author?: string;

  createdAt: string;
}

export interface Photo {
  id: string;

  url: string;

  caption?: string;
}

export interface Story {
  id: string;

  title: string;

  body: string;
}

export interface Weather {
  temperature?: number;

  conditions?: string;
}

export interface Location {
  latitude?: number;

  longitude?: number;
}

export type ObservationType =
  | "plant"
  | "wildlife"
  | "maintenance"
  | "change"
  | "season"
  | "general";