import { useSmartHomeStore } from '../../store/emoji-app.store';

export const Dashboard = () => {
  const lights = useSmartHomeStore((state) => state.lights);
  const scenes = useSmartHomeStore((state) => state.scenes);
  const scheduledScenes = useSmartHomeStore((state) => state.scheduledScenes);

  return (
    <div className="flex flex-col gap-4">
      <div className="py-2">
        <p className="text-lg font-bold">Dashboard</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 border rounded-lg">
          <p className="text-sm text-gray-600">Total Lights</p>
          <p className="text-2xl font-bold">{lights.length}</p>
        </div>
        <div className="p-4 border rounded-lg">
          <p className="text-sm text-gray-600">Total Scenes</p>
          <p className="text-2xl font-bold">{scenes.length}</p>
        </div>
        <div className="p-4 border rounded-lg">
          <p className="text-sm text-gray-600">Scheduled Scenes</p>
          <p className="text-2xl font-bold">{scheduledScenes.length}</p>
        </div>
      </div>
    </div>
  );
};

