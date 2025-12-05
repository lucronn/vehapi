export interface ApiResponse<T> {
  header: {
    status: string;
    statusCode: number;
    date?: string;
    messages?: any[];
  };
  body: T;
}

export interface VinDecodeData {
  vehicleId: string;
  contentSource: string;
  motorVehicleId: string;
}

export interface Make {
  makeId: number;
  makeName: string;
}

export interface Model {
  model: string;
  id: string;
  engines?: Engine[];
}

export interface Engine {
  id: string;
  name: string;
}

export interface ModelsData {
  contentSource: string;
  models: Model[];
}

export interface Article {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  description?: string;
  bucket: string;
  parentBucket?: string;
  thumbnailHref?: string;
  bulletinNumber?: string;
  releaseDate?: string;
  sort?: number;
}

export interface FilterTab {
  name: string;
  count: number;
  type: string;
}

export interface ArticlesData {
  articleDetails: Article[];
  filterTabs: FilterTab[];
}

export interface ArticleContentData {
  html: string;
}

export interface PersistedVehicle {
    vehicleId: string;
    contentSource: string;
    name: string;
}

export interface AISearchSummary {
    likelyCauses: {
        cause: string;
        articles: { title: string; id: string; }[];
    }[];
}