import { useEffect } from "react";
import { BRIDGE_DIRECT_URL } from "../lib/live";
import { useI18n } from "../i18n/useI18n";
import { SparkIcon, XIcon } from "./icons";

interface Props {
  onClose: () => void;
}

/** What-this-is card: provenance, render modes, controls. Replaces the dead
 *  external docs link — everything shown is true of this repo. Bilingual
 *  (RU/EN) through the shared dictionary, so it follows the language toggle. */
export default function AboutModal({ onClose }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // the bridge URL is rendered as a selectable <code> in the middle of the copy
  const [bridgeBefore, bridgeAfter] = t.aboutBridge.split("{url}");

  return (
    <div className="errwrap" role="dialog" aria-label={t.aboutAria} onClick={onClose}>
      <div className="errcard about" onClick={(e) => e.stopPropagation()}>
        <h2>
          <SparkIcon size={16} /> Memory Travel
          <button className="ghostbtn" onClick={onClose} title={t.aboutClose}>
            <XIcon size={13} />
          </button>
        </h2>
        <p>{t.aboutIntro}</p>
        <p>{t.aboutCosmos}</p>
        <p>{t.aboutTravel}</p>
        <p className="dim">{t.aboutProvenance}</p>
        <p className="dim">{t.aboutRendering}</p>
        <p className="dim">
          {bridgeBefore}
          <code>{BRIDGE_DIRECT_URL}</code>
          {bridgeAfter}
        </p>
        <p className="dim">{t.aboutRepo}</p>
      </div>
    </div>
  );
}
