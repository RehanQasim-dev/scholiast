import DriveSyncCard from "../components/DriveSyncCard";
import GithubSyncCard from "../components/GithubSyncCard";
import AboutSection from "../components/settings/AboutSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import ExcalidrawSettingsSection from "../components/settings/ExcalidrawSettingsSection";
import DataSection from "../components/settings/DataSection";
import ModelManagerSection from "../components/settings/ModelManagerSection";
import PlaybackSection from "../components/settings/PlaybackSection";
import PromptsEditor from "../components/settings/PromptsEditor";
import SpeechSection from "../components/settings/SpeechSection";

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 mb-7 break-inside-avoid">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-text-3">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface p-4 sm:p-5">
        {children}
      </div>
    </section>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-7 px-6 pt-7 sm:pt-9 pb-28 bg-base min-h-full">
      <h1 className="text-2xl font-bold tracking-tight text-text">Settings</h1>

      {/* Masonry: cards stack tight with no row-stretch holes; single column on mobile. */}
      <div className="lg:columns-2 lg:gap-x-7">
        <Group title="Speech">
          <SpeechSection />
        </Group>
        <Group title="Prompts">
          <PromptsEditor />
        </Group>
        <Group title="Local models">
          <ModelManagerSection />
        </Group>
        <Group title="Excalidraw & Stylus">
          <ExcalidrawSettingsSection />
        </Group>
        <Group title="Sync">
          <div className="space-y-7">
            <DriveSyncCard />
            <GithubSyncCard />
          </div>
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
    </div>
  );
}
