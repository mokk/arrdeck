import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

/** Anything that is not a route. Without this an unknown path — a stale
 * deep-link, a mistyped bookmark — renders an empty page with no way back,
 * which reads as a crash. */
export function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <div className="py-10 text-center">
      <div className="text-lg font-semibold">{t("common.notFound")}</div>
      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{pathname}</div>
      <Link
        to="/"
        className="mt-4 inline-block rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-primary"
      >
        {t("common.backToDashboard")}
      </Link>
    </div>
  );
}
