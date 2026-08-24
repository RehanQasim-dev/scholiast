import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

export default function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2 text-sm text-text-2">
      <p>
        Scholiast {version ? `v${version}` : ""}
      </p>
      <p>
        Your library lives on this device. Speech audio is sent to Groq or
        Gemini only while you dictate; sync copies annotations to your own
        Google Drive app folder. Nothing else leaves the app.
      </p>
    </div>
  );
}
