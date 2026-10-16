import { AlertIcon, XIcon } from "./icons";

interface Props {
  title: string;
  body: string;
  detail?: string | null;
  onDismiss?: () => void;
  dismissLabel?: string;
}

/** Full-view readable failure card. Replaces the silent black canvas: any
 *  init / data-load / render failure funnels here with stage + detail. */
export default function ErrorOverlay({ title, body, detail, onDismiss, dismissLabel }: Props) {
  return (
    <div className="errwrap" role="alert">
      <div className="errcard">
        <h2>
          <AlertIcon size={18} /> {title}
        </h2>
        <p>{body}</p>
        {detail && <pre className="errdetail">{detail}</pre>}
        {onDismiss && (
          <button onClick={onDismiss}>
            <XIcon size={12} /> {dismissLabel ?? "continue anyway (text only)"}
          </button>
        )}
      </div>
    </div>
  );
}
