import { Users, Package, MapPin } from "lucide-react";
import type React from "react";

export const KR = "#f9423a";
export const KR_BG = "rgba(249,66,58,0.10)";
export const KR_BORDER = "rgba(249,66,58,0.25)";

export type AssetType = "character" | "item" | "background";

export interface FocalPoint {
  x: number;
  y: number;
  scale?: number;
}

export interface Asset {
  id: string;
  project_id: string;
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  outfit_description: string | null;
  role_description: string | null;
  signature_items: string | null;
  space_description: string | null;
  asset_type: AssetType;
  source_type: string;
  created_at: string;
}

export const TYPE_LABEL: Record<AssetType, string> = {
  character: "Character",
  item: "Item",
  background: "Background",
};

export const TYPE_META: Record<
  AssetType,
  {
    label: string;
    icon: React.ReactNode;
    gridCols: string;
    emptyIcon: React.ReactNode;
    emptyText: string;
    addLabel: string;
  }
> = {
  character: {
    label: "Character",
    icon: <Users className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <Users className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register characters to @tag them in scenes and reference during conti generation",
    addLabel: "Add Character",
  },
  item: {
    label: "Item",
    icon: <Package className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <Package className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register props to auto-inject material and detail info when tagging scenes",
    addLabel: "Add Item",
  },
  background: {
    label: "Background",
    icon: <MapPin className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <MapPin className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register locations to maintain spatial consistency across tagged scenes",
    addLabel: "Add Background",
  },
};
