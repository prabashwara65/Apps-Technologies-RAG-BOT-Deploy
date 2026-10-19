import sidebarLogo from "../assets/logo.jpg";
import lightBackgroundLogo from "../assets/apps-light.png";
import darkBackgroundLogo from "../assets/apps-dark.png";

/** Each image can be replaced independently, keeping its filename. */
export function BrandLogo({ watermark = false }: { watermark?: boolean }) {
  if (watermark) {
    return (
      <span className="brand-watermark" aria-hidden="true">
        <img
          className="brand-watermark__light-image"
          src={lightBackgroundLogo}
          alt=""
          draggable={false}
        />
        <img
          className="brand-watermark__dark-image"
          src={darkBackgroundLogo}
          alt=""
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span className="brand-logo" aria-hidden="true">
      <img src={sidebarLogo} width="43" height="43" alt="" draggable={false} />
    </span>
  );
}
