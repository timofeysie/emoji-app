import { useEffect, useRef } from 'react';
import { SceneDialogForm } from './SceneDialogForm';
import { Button } from '../../shared/button';
import { SceneLight as SceneLightModel } from '../../models/scene.model';

interface AddSceneDialogTriggerProps {
  sceneName?: string;
  lightIds?: string[];
}

/**
 * Component that opens the Add Scene dialog when rendered.
 * Can be exposed to the AI to allow it to trigger opening the Add Scene modal.
 * When the AI renders this component, it will automatically open the Add Scene dialog.
 * 
 * @param sceneName - Optional initial scene name to pre-fill
 * @param lightIds - Optional array of light IDs to automatically add to the scene
 */
export const AddSceneDialogTrigger = ({
  sceneName,
  lightIds,
}: AddSceneDialogTriggerProps = {}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Convert lightIds to SceneLightModel format
  const initialLights: SceneLightModel[] | undefined = lightIds?.map(
    (lightId) => ({
      lightId,
      brightness: 100, // Default brightness
    }),
  );

  // Auto-click the button when component mounts to open the dialog
  useEffect(() => {
    // Small delay to ensure the button is rendered and dialog is ready
    const timer = setTimeout(() => {
      buttonRef.current?.click();
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SceneDialogForm
      initialSceneName={sceneName}
      initialLights={initialLights}
    >
      <Button ref={buttonRef} variant="outline" className="hidden">
        Add Scene
      </Button>
    </SceneDialogForm>
  );
};

