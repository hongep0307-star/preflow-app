import { memo } from "react";
import { type FocalPoint, KR } from "./types";

interface Props {
  url: string | null;
  focal: FocalPoint;
  name: string;
}

export const SquareAvatar = memo(function SquareAvatar({ url, focal, name }: Props) {
  return (
  <div className="w-full flex items-center justify-center pt-4 pb-3">
    <div
      className="rounded-full overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition-all"
      style={{ width: 128, height: 128, background: "hsl(var(--elevated))" }}
    >
      {url ? (
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `url(${url})`,
            backgroundSize: `${Math.round((focal.scale ?? 1.4) * 100)}%`,
            backgroundPosition: `${focal.x}% ${focal.y}%`,
          }}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white font-bold text-3xl"
          style={{ background: KR }}
        >
          {name.charAt(0)}
        </div>
      )}
    </div>
  </div>
  );
});
