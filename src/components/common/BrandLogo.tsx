import { cn } from "@/lib/utils";

type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
};

const sizeMap = {
  sm: {
    wrap: "gap-2",
    mark: "w-[18px] h-[14px]",
    text: "text-[20px]",
    scale: "scale-125",
  },
  md: {
    wrap: "gap-3",
    mark: "w-[22px] h-[17px]",
    text: "text-[26px]",
    scale: "scale-150",
  },
  lg: {
    wrap: "gap-3",
    mark: "w-12 h-[38px]",
    text: "text-[32px]",
    scale: "scale-100",
  },
} as const;

export const FilmMark = ({ size = "md", className }: Pick<BrandLogoProps, "size" | "className">) => {
  const cfg = sizeMap[size];
  const isLarge = size === "lg";

  return (
    <div className={cn("relative flex-shrink-0 origin-center", cfg.mark, cfg.scale, className)}>
      <div
        className={cn(
          "absolute bottom-0 right-0 border border-border-subtle bg-surface-panel",
          isLarge ? "w-[30px] h-[22px] rounded-[3px] border-2" : "w-[13px] h-[9px] rounded-[2px]",
        )}
      />
      <div
        className={cn(
          "absolute border border-primary/25 bg-primary/5",
          isLarge
            ? "bottom-[5px] right-[5px] w-[32px] h-[24px] rounded-[3px] border-2"
            : "bottom-[2.5px] right-[2.5px] w-[14px] h-[10px] rounded-[2px]",
        )}
      />
      <div
        className={cn(
          "absolute border-primary bg-primary/10",
          isLarge
            ? "bottom-[10px] right-[9px] w-[34px] h-[26px] rounded-[3px] border-2"
            : "bottom-[5px] right-[4.5px] w-[15px] h-[11px] rounded-[2px] border-[1.5px]",
        )}
      >
        <span
          className={cn(
            "absolute bg-primary",
            isLarge
              ? "left-[3px] top-[28%] w-[4px] h-[4px] rounded-[1px]"
              : "left-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] rounded-[0.5px]",
          )}
        />
        <span
          className={cn(
            "absolute bg-primary",
            isLarge
              ? "right-[3px] top-[28%] w-[4px] h-[4px] rounded-[1px]"
              : "right-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] rounded-[0.5px]",
          )}
        />
        {isLarge && (
          <>
            <span className="absolute left-[3px] top-[58%] w-[4px] h-[4px] rounded-[1px] bg-primary" />
            <span className="absolute right-[3px] top-[58%] w-[4px] h-[4px] rounded-[1px] bg-primary" />
          </>
        )}
      </div>
    </div>
  );
};

export const BrandLogo = ({ size = "md", showText = true, className }: BrandLogoProps) => {
  const cfg = sizeMap[size];

  return (
    <div className={cn("flex items-center leading-none select-none", cfg.wrap, className)}>
      <FilmMark size={size} />
      {showText && (
        <span className={cn("font-extrabold tracking-tight", cfg.text)}>
          <span className="text-foreground">Pre</span>
          <span className="text-primary">-Flow</span>
        </span>
      )}
    </div>
  );
};
