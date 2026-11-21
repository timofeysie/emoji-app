import { s } from '@hashbrownai/core';
import { exposeComponent, useRuntimeFunction, useTool } from '@hashbrownai/react';
import { Light } from '../../models/light.model';
import { useSmartHomeStore } from '../../store/emoji-app.store';
import { AddSceneDialogTrigger } from '../../views/components/AddSceneDialogTrigger';
import { LightChatComponent } from '../../views/components/LightChatComponent';
import type { ChatArea } from '../chat-area';
import { section } from '../prompt-sections';

/** The smart-home demo: lights, scenes and the Add Scene dialog. */
export function useSmartHomeChatArea(): ChatArea {
  const getLights = useTool({
    name: 'getLights',
    description: 'Get the current lights. Returns an array of light objects, each with an id (string), name (string), and brightness (number). Use the id field when calling other tools like deleteLight or controlLight.',
    handler: () => Promise.resolve(useSmartHomeStore.getState().lights),
    deps: [],
  });
  const getScenes = useTool({
    name: 'getScenes',
    description: 'Get the current scenes. Returns an array of scene objects, each with an id (string), name (string), and lights (array). Use the id field when calling other tools like deleteScene.',
    handler: () => Promise.resolve(useSmartHomeStore.getState().scenes),
    deps: [],
  });
  const controlLight = useTool({
    name: 'controlLight',
    description: 'Control the light. Brightness is a number between 0 and 100.',
    schema: s.object('Control light input', {
      lightId: s.string('The id of the light'),
      brightness: s.number('The brightness of the light, between 0 and 100'),
    }),
    handler: (input) => {
      const { lightId, brightness } = input;

      useSmartHomeStore.getState().updateLight(lightId, {
        brightness,
      });

      return Promise.resolve(true);
    },
    deps: [],
  });
  const deleteLight = useTool({
    name: 'deleteLight',
    description: 'Delete a light by its id. You must first call getLights to find the light by name, then use the id field from that light object. The lightId must be the exact id string from the light object. Returns the deleted light id if successful, or an error if the light was not found.',
    schema: s.object('Delete light input', {
      lightId: s.string('The id of the light to delete. This must be the exact id string from the light object returned by getLights.'),
    }),
    handler: (input) => {
      const { lightId } = input;
      const store = useSmartHomeStore.getState();
      const light = store.lights.find((l) => l.id === lightId);

      if (!light) {
        return Promise.reject(
          new Error(
            `Light with id "${lightId}" not found. Make sure to call getLights first to get the correct light id.`,
          ),
        );
      }

      store.deleteLight(lightId);

      return Promise.resolve({
        success: true,
        deletedLightId: lightId,
        deletedLightName: light.name,
      });
    },
    deps: [],
  });
  const deleteScene = useTool({
    name: 'deleteScene',
    description: 'Delete a scene by its id. You must first call getScenes to find the scene by name, then use the id field from that scene object. The sceneId must be the exact id string from the scene object. Returns the deleted scene id if successful, or an error if the scene was not found.',
    schema: s.object('Delete scene input', {
      sceneId: s.string('The id of the scene to delete. This must be the exact id string from the scene object returned by getScenes.'),
    }),
    handler: (input) => {
      const { sceneId } = input;
      const store = useSmartHomeStore.getState();
      const scene = store.scenes.find((s) => s.id === sceneId);
  
      if (!scene) {
        return Promise.reject(
          new Error(
            `Scene with id "${sceneId}" not found. Make sure to call getScenes first to get the correct scene id.`,
          ),
        );
      }
  
      store.deleteScene(sceneId);
  
      return Promise.resolve({
        success: true,
        deletedSceneId: sceneId,
        deletedSceneName: scene.name,
      });
    },
    deps: [],
  });
  const createLight = useRuntimeFunction({
    name: 'createLight',
    description: 'Create a new light',
    args: s.object('Create light input', {
      name: s.string('The name of the light'),
    }),
    result: s.object('Create light result', {
      lightId: s.string('The id of the light'),
    }),
    deps: [],
    handler: (input) => {
      const { name } = input;
      const light: Light = {
        id: crypto.randomUUID(),
        name,
        brightness: 0,
      };

      useSmartHomeStore.getState().addLight(light);

      return Promise.resolve({ lightId: light.id });
    },
  });

  // Arrays must be passed as template interpolations, not as literal {[]} text,
  // so the system prompt validator receives real JavaScript arrays.
  const noLightIds: string[] = [];
  const exampleEveningLightIds = ['kitchen-light-id'];
  const exampleOfficeLightIds = ['office-light-id-from-getLights'];

  return {
    tools: [getLights, controlLight, deleteLight, getScenes, deleteScene],
    runtimeFunctions: [createLight],
    components: [
      exposeComponent(LightChatComponent, {
        name: 'LightChat',
        description: 'A component that lets the user control a light',
        props: {
          lightId: s.string('The id of the light'),
        },
      }),
      exposeComponent(AddSceneDialogTrigger, {
        name: 'AddScene',
        description: 'Open the Add Scene dialog to allow the user to create a new scene. Always pass both props: use an empty string for sceneName and an empty array for lightIds when not pre-filling. Call getLights first to get valid light IDs for the lightIds prop.',
        props: {
          sceneName: s.string('The name for the new scene. Pass empty string if not pre-filling.'),
          lightIds: s.array(
            'Array of light IDs to pre-add to the scene. Pass empty array if not pre-filling.',
            s.string('The ID of a light to add'),
          ),
        },
      }),
    ],
    prompt: section`
      ## Smart-home demo
      You can control the lights in the house.

      Always prefer writing a single script for the javascript tool over calling
      the javascript tool multiple times.

      ### EXAMPLES

      <user>What are the lights in the living room?</user>
      <assistant>
        <tool-call>getLights</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Card title="Living Room Lights" description="Here are the lights in the living room:">
            <LightChat lightId="..." />
            <LightChat lightId="..." />
          </Card>
        </ui>
      </assistant>

      <user>Delete the kitchen light</user>
      <assistant>
        <tool-call>getLights</tool-call>
      </assistant>
      <assistant>
        <tool-call>deleteLight</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>I have deleted the kitchen light.</Markdown>
        </ui>
      </assistant>

      ### CRITICAL: Finding Lights by Name to Delete
      When the user asks to delete a light by name (e.g., "Delete the kitchen light" or "Remove the bedroom light"):
      1. ALWAYS call getLights first - This returns an array of light objects, each with: id (string), name (string), and brightness (number)
      2. Find the matching light - Search the array for a light where the name matches the user's request (case-insensitive, partial matches are acceptable)
      3. Extract the id - Use the exact id string from the matching light object
      4. Call deleteLight - Pass that exact id as the lightId parameter
      5. NEVER guess IDs - You must always call getLights first to get the actual ID. Never use made-up IDs or try to construct them.
      6. If no match found - Tell the user the light was not found rather than trying to delete with a guessed ID

      ### CRITICAL: Finding Scenes by Name to Delete
      When the user asks to delete a scene by name (e.g., "Delete the Automation Scene" or "Remove the Evening scene"):
      1. ALWAYS call getScenes first - This returns an array of scene objects, each with: id (string), name (string), and lights (array)
      2. Find the matching scene - Search the array for a scene where the name matches the user's request (case-insensitive, partial matches are acceptable)
      3. Extract the id - Use the exact id string from the matching scene object
      4. Call deleteScene - Pass that exact id as the sceneId parameter
      5. NEVER guess IDs - You must always call getScenes first to get the actual ID. Never use made-up IDs or try to construct them.
      6. If no match found - Tell the user the scene was not found rather than trying to delete with a guessed ID

      ### Opening the Add Scene Dialog
      When the user asks to add, create, or make a new scene (e.g., "Add a scene", "Create a new scene", "I want to make a scene"):
      - Use the <AddScene> component to open the Add Scene dialog
      - The dialog will allow the user to configure the scene name and select lights
      - You can optionally pre-fill the scene name and automatically add lights by passing props
      - **IMPORTANT**: If the user asks you to "enter" or "type" a scene name (e.g., "enter the name 'New Scene'"), you must use the setFormInputValue tool AFTER opening the modal, not the sceneName prop. The sceneName prop only pre-fills, but setFormInputValue actually fills the input field.
      - Examples:
        <user>Add a new scene</user>
        <assistant>
          <ui>
            <AddScene sceneName="" lightIds=${noLightIds} />
          </ui>
        </assistant>

        <user>Create a scene called "Evening" with the kitchen light</user>
        <assistant>
          <tool-call>getLights</tool-call>
        </assistant>
        <assistant>
          <ui>
            <AddScene sceneName="Evening" lightIds=${exampleEveningLightIds} />
          </ui>
        </assistant>

        <user>Open the Add Scene modal and enter the name "New Scene"</user>
        <assistant>
          <ui>
            <AddScene sceneName="" lightIds=${noLightIds} />
          </ui>
        </assistant>
        <assistant>
          <tool-call>setFormInputValue</tool-call>
          <tool-args>{"inputId": "sceneName", "value": "New Scene"}</tool-args>
        </assistant>

      ### Adding Lights to a Scene
      When the user asks to add specific lights to a scene:
      1. ALWAYS call getLights first to get the list of available lights and their IDs
      2. Find the matching lights by name (case-insensitive, partial matches acceptable)
      3. Extract the exact id strings from the matching light objects
      4. Use the <AddScene> component with the lightIds prop containing an array of those IDs
      5. You can also set the sceneName prop if the user specified a name
      6. Example:
        <user>Open the Add Scene modal and add the Office Light</user>
        <assistant>
          <tool-call>getLights</tool-call>
        </assistant>
        <assistant>
          <ui>
            <AddScene sceneName="" lightIds=${exampleOfficeLightIds} />
          </ui>
        </assistant>

      ### Completing the Add Scene Modal
      When the user asks you to complete or confirm actions in the Add Scene modal (e.g., "press the add scene button", "confirm the new scene", "click add scene"):
      1. First, make sure the modal is open (use <AddScene> component if needed)
      2. **If the user asks to "enter" or "type" a scene name** (e.g., "enter the name 'New Scene'"), you MUST use setFormInputValue with inputId="sceneName" and the desired value. Do NOT use the sceneName prop on <AddScene> - that only pre-fills and doesn't actually fill the input field.
      3. If the user wants to select a light, use selectOptionByText with selectId="addLight" and optionText set to the light name (e.g., "Office Light", "Kitchen Light")
      4. **IMPORTANT**: After selecting an option, wait for the select dropdown to close before clicking the button. The selectOptionByText tool will handle this automatically.
      5. To confirm/submit the form, use clickButtonByText with buttonText="Add Scene" (or "Update Scene" if editing)
      6. **CRITICAL**: Only click the button ONCE. Do not interact with the select again after clicking the button. The clickButtonByText tool will automatically close any open dropdowns before clicking.
      7. Example:
        <user>Open the Add Scene modal, enter the name "New Scene", select "Office Light", and click Add Scene</user>
        <assistant>
          <ui>
            <AddScene sceneName="" lightIds=${noLightIds} />
          </ui>
        </assistant>
        <assistant>
          <tool-call>setFormInputValue</tool-call>
          <tool-args>{"inputId": "sceneName", "value": "New Scene"}</tool-args>
        </assistant>
        <assistant>
          <tool-call>getLights</tool-call>
        </assistant>
        <assistant>
          <tool-call>selectOptionByText</tool-call>
          <tool-args>{"selectId": "addLight", "optionText": "Office Light"}</tool-args>
        </assistant>
        <assistant>
          <tool-call>clickButtonByText</tool-call>
          <tool-args>{"buttonText": "Add Scene"}</tool-args>
        </assistant>
      8. More examples:
        <user>Press the add scene button in the modal to confirm the new scene</user>
        <assistant>
          <tool-call>clickButtonByText</tool-call>
          <tool-args>{"buttonText": "Add Scene"}</tool-args>
        </assistant>

        <user>Enter "Evening" as the scene name and click Add Scene</user>
        <assistant>
          <tool-call>setFormInputValue</tool-call>
          <tool-args>{"inputId": "sceneName", "value": "Evening"}</tool-args>
        </assistant>
        <assistant>
          <tool-call>clickButtonByText</tool-call>
          <tool-args>{"buttonText": "Add Scene"}</tool-args>
        </assistant>

        <user>Select "Office Light" from the dropdown and confirm</user>
        <assistant>
          <tool-call>selectOptionByText</tool-call>
          <tool-args>{"selectId": "addLight", "optionText": "Office Light"}</tool-args>
        </assistant>
        <assistant>
          <tool-call>clickButtonByText</tool-call>
          <tool-args>{"buttonText": "Add Scene"}</tool-args>
        </assistant>
    `,
  };
}
