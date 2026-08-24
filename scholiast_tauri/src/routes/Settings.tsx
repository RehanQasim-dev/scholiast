import DriveSection from "../components/DriveSection";
import AboutSection from "../components/settings/AboutSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import DataSection from "../components/settings/DataSection";
import ModelManagerSection from "../components/settings/ModelManagerSection";
import PlaybackSection from "../components/settings/PlaybackSection";
import PromptsEditor from "../components/settings/PromptsEditor";
import SpeechSection from "../components/settings/SpeechSection";
import SyncProgressCard from "../components/settings/SyncProgressCard";

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Group title="Speech">
        <SpeechSection />
      </Group>
      <Group title="Prompts">
        <PromptsEditor />
      </Group>
      <Group title="Local models">
        <ModelManagerSection />
      </Group>

      <Group title="Sync">
        <DriveSection />
        <SyncProgressCard />
      </Group>

      <Group title="Playback">
        <PlaybackSection />
      </Group>

      <Group title="Appearance">
        <AppearanceSection />
      </Group>

      <Group title="Data">
        <DataSection />
      </Group>

      <Group title="About">
        <AboutSection />
      </Group>
    </div>
  );
}
