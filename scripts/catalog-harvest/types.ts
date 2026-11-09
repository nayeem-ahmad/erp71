export type HarvestProduct = {
  url: string;
  productCode: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  status: string | null;
  warrantyText: string | null;
  breadcrumbs: string[];
  inStock: boolean;
};
