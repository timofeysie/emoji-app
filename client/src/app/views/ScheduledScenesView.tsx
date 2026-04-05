import { Weekday } from '../models/scheduled-scene.model';
import { useSmartHomeStore } from '../store/emoji-app.store';
import { ScheduledScene } from './components/ScheduledScene';

const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const ScheduledScenesView = () => {
  const scheduledScenes = useSmartHomeStore((state) => state.scheduledScenes);

  return (
    <div className="flex flex-col gap-4">
      {scheduledScenes.map((scheduledScene) => (
        <ScheduledScene
          key={scheduledScene.id}
          scheduledScene={scheduledScene}
          onEdit={() => {}}
        />
      ))}
    </div>
  );
};
