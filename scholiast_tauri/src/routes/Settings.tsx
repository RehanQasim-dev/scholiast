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
    <section className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SingleCardGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-10 bg-base min-h-full">
      <h1 className="text-2xl font-semibold text-text">Settings</h1>

      <Group title="Speech">
        <SpeechSection />
      </Group>
      <Group title="Prompts">
        <PromptsEditor />
      </Group>
      <Group title="Local models">
        <ModelManagerSection />
      </Group>

      <SingleCardGroup title="Sync">
        <div className="space-y-3">
          <DriveSection />
          <SyncProgressCard />
        </div>
      </SingleCardGroup>

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
