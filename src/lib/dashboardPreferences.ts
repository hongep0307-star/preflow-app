export type DashboardCardsPerRow = 4 | 5 | 6 | 7 | 8;

export const DASHBOARD_CARDS_PER_ROW_OPTIONS: DashboardCardsPerRow[] = [4, 5, 6, 7, 8];
export const DEFAULT_DASHBOARD_CARDS_PER_ROW: DashboardCardsPerRow = 6;
export const DASHBOARD_CARDS_PER_ROW_CHANGED_EVENT = "preflow:dashboard-cards-per-row-changed";

const DASHBOARD_CARDS_PER_ROW_STORAGE_KEY = "preflow.dashboard.cardsPerRow";

export const readDashboardCardsPerRow = (): DashboardCardsPerRow => {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_CARDS_PER_ROW;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_CARDS_PER_ROW_STORAGE_KEY);
    const value = Number(raw);
    return DASHBOARD_CARDS_PER_ROW_OPTIONS.includes(value as DashboardCardsPerRow)
      ? (value as DashboardCardsPerRow)
      : DEFAULT_DASHBOARD_CARDS_PER_ROW;
  } catch {
    return DEFAULT_DASHBOARD_CARDS_PER_ROW;
  }
};

export const saveDashboardCardsPerRow = (value: DashboardCardsPerRow) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DASHBOARD_CARDS_PER_ROW_STORAGE_KEY, String(value));
    window.dispatchEvent(new CustomEvent(DASHBOARD_CARDS_PER_ROW_CHANGED_EVENT, { detail: value }));
  } catch {
    // Keep the in-memory UI usable even if localStorage is unavailable.
  }
};
