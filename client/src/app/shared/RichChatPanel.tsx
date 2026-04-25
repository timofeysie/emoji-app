import { Chat, prompt, s } from '@hashbrownai/core';
import {
  exposeComponent,
  useRuntime,
  useRuntimeFunction,
  useTool,
  useToolJavaScript,
  useUiChat,
} from '@hashbrownai/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSmartHomeStore } from '../store/emoji-app.store';
import { LightChatComponent } from '../views/components/LightChatComponent';
import { AddSceneDialogTrigger } from '../views/components/AddSceneDialogTrigger';
import { Button } from './button';
import { CardComponent } from './CardComponent';
import { MarkdownComponent } from './MarkdownComponent';
import { RichMessage } from './RichMessage';
import { ScrollArea } from './scrollarea';
import { Textarea } from './textarea';
import { Light } from '../models/light.model';

export const RichChatPanel = () => {
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

  // DOM interaction tools for completing modals and forms
  const setFormInputValue = useTool({
    name: 'setFormInputValue',
    description: 'Set the value of an input field. Use this to fill in form fields like scene names, text inputs, etc. The inputId should be the id attribute of the input element, or you can use a label to find the associated input.',
    schema: s.object('Set input value', {
      inputId: s.string('The id attribute of the input element (e.g., "sceneName")'),
      value: s.string('The value to set in the input field'),
    }),
    handler: (input) => {
      const { inputId, value } = input;
      
      // Wait a bit for the modal to be fully rendered, then try to find and set the input
      return new Promise((resolve, reject) => {
        const trySetValue = (attempt: number) => {
          setTimeout(() => {
            const inputElement = document.getElementById(inputId) as HTMLInputElement;
            
            if (!inputElement) {
              if (attempt < 5) {
                // Retry if element not found yet (modal might still be opening)
                trySetValue(attempt + 1);
                return;
              }
              reject(
                new Error(`Input element with id "${inputId}" not found. Make sure the modal is open and the input exists.`),
              );
              return;
            }

            // Focus the input first to ensure it's active
            inputElement.focus();

            // Clear any existing value first
            inputElement.value = '';

            // Use the native value setter to bypass React's restrictions
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value'
            )?.set;
            
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(inputElement, value);
            } else {
              inputElement.value = value;
            }

            // Create and dispatch an InputEvent (more compatible with React than Event)
            // Use 'beforeinput' and 'input' events to simulate real typing
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: value,
            });
            inputElement.dispatchEvent(beforeInputEvent);

            const inputEvent = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: value,
            });
            inputElement.dispatchEvent(inputEvent);

            // Also dispatch a change event
            const changeEvent = new Event('change', {
              bubbles: true,
              cancelable: true,
            });
            inputElement.dispatchEvent(changeEvent);

            // Trigger a blur event to ensure React processes the change
            inputElement.blur();
            
            // Re-focus to show the value was set
            inputElement.focus();

            resolve({ success: true, inputId, value });
          }, attempt * 100); // 0ms, 100ms, 200ms, etc.
        };

        trySetValue(0);
      });
    },
    deps: [],
  });

  const clickButtonByText = useTool({
    name: 'clickButtonByText',
    description: 'Click a button by finding it by its text content. Use this to click buttons in modals, like "Add Scene", "Update Scene", "Cancel", etc. The buttonText should match the exact text displayed on the button. This tool will automatically close any open dropdowns before clicking.',
    schema: s.object('Click button by text', {
      buttonText: s.string('The text content of the button to click (e.g., "Add Scene", "Update Scene", "Cancel")'),
    }),
    handler: (input) => {
      const { buttonText } = input;
      
      // Helper to check if select is open
      const checkIfSelectOpen = () => {
        const options = Array.from(
          document.querySelectorAll('[role="option"], [data-radix-select-item]')
        );
        return options.length > 0;
      };
      
      // Helper to close select
      const closeSelect = () => {
        // Press Escape multiple times to ensure it closes
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          }, i * 50);
        }
      };
      
      // First, ensure any open select dropdowns are closed
      const wasOpen = checkIfSelectOpen();
      if (wasOpen) {
        closeSelect();
      }
      
      // Wait for dropdowns to close, then find and click the button
      return new Promise((resolve, reject) => {
        const findAndClickButton = (attempt: number) => {
          setTimeout(() => {
            // Double-check select is closed
            const stillOpen = checkIfSelectOpen();
            if (stillOpen && attempt < 5) {
              closeSelect();
              findAndClickButton(attempt + 1);
              return;
            }
            
            // Find all buttons
            const buttons = Array.from(document.querySelectorAll('button'));
            
            // Filter out buttons that are inside dropdowns, portals, or hidden
            const modalButtons = buttons.filter((btn) => {
              // Exclude hidden buttons (like the trigger button in AddSceneDialogTrigger)
              if (btn.classList.contains('hidden') || 
                  btn.hasAttribute('hidden') ||
                  window.getComputedStyle(btn).display === 'none' ||
                  window.getComputedStyle(btn).visibility === 'hidden') {
                return false;
              }
              
              // Check if button is inside a select content (portal) or listbox
              const isInSelect = btn.closest('[role="listbox"]') || 
                                 btn.closest('[data-radix-select-content]') ||
                                 btn.closest('[data-radix-select-viewport]');
              
              // Check if button is visible
              const isVisible = btn.offsetParent !== null;
              
              // Check if button is inside the main dialog content (not in a portal)
              const isInDialog = btn.closest('[role="dialog"]') !== null;
              
              return !isInSelect && isVisible && isInDialog;
            });
            
            const button = modalButtons.find(
              (btn) => btn.textContent?.trim() === buttonText.trim()
            );

            if (!button) {
              reject(
                new Error(`Button with text "${buttonText}" not found. Make sure the modal is open and the button exists. Available buttons: ${modalButtons.map(b => b.textContent?.trim()).filter(Boolean).join(', ') || 'none'}`),
              );
              return;
            }

            // Double-check button is not hidden (should already be filtered, but be extra safe)
            if (button.classList.contains('hidden') || 
                button.hasAttribute('hidden') ||
                window.getComputedStyle(button).display === 'none') {
              reject(
                new Error(`Button with text "${buttonText}" is hidden and should not be clicked.`),
              );
              return;
            }
            
            // Use the native click method which React handles better than synthetic events
            // But first, ensure no select dropdowns are open
            const finalCheck = checkIfSelectOpen();
            if (finalCheck) {
              // One more escape to be sure
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              setTimeout(() => {
                button.click();
                resolve({ success: true, buttonText });
              }, 100);
            } else {
              button.click();
              resolve({ success: true, buttonText });
            }
            
            resolve({ success: true, buttonText });
          }, wasOpen ? 200 : 50); // Wait longer if we had to close a dropdown
        };

        findAndClickButton(1);
      });
    },
    deps: [],
  });

  const selectOptionByText = useTool({
    name: 'selectOptionByText',
    description: 'Select an option from a select dropdown by the option text. First opens the select if needed, then selects the option. Use this to select lights in the scene dialog. The selectId should be the id of the select trigger element (e.g., "addLight"), and optionText should match the text of the option to select.',
    schema: s.object('Select option by text', {
      selectId: s.string('The id attribute of the select trigger element (e.g., "addLight")'),
      optionText: s.string('The text content of the option to select (e.g., "Office Light", "Kitchen Light")'),
    }),
    handler: (input) => {
      const { selectId, optionText } = input;
      
      // Find the select trigger
      const selectTrigger = document.getElementById(selectId) as HTMLElement;
      if (!selectTrigger) {
        return Promise.reject(
          new Error(`Select element with id "${selectId}" not found. Make sure the modal is open and the select exists.`),
        );
      }

      // Check if select is already open by looking for options in the document
      const checkIfSelectOpen = () => {
        const options = Array.from(
          document.querySelectorAll('[role="option"], [data-radix-select-item]')
        );
        return options.length > 0;
      };
      
      const wasOpen = checkIfSelectOpen();

      // Only click to open if not already open
      if (!wasOpen) {
        // Use a more controlled approach - stop propagation
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        selectTrigger.dispatchEvent(clickEvent);
      }

      // Wait for the select to open (if we just opened it) and find the option
      return new Promise((resolve, reject) => {
        // Try multiple times with increasing delays to handle async rendering
        const trySelect = (attempt: number) => {
          setTimeout(() => {
            // Look for Radix UI Select items
            const options = Array.from(
              document.querySelectorAll('[role="option"], [data-radix-select-item]')
            );
            
            if (options.length === 0 && !wasOpen && attempt < 8) {
              // Select not open yet, try again
              trySelect(attempt + 1);
              return;
            }

            if (options.length === 0 && !wasOpen && attempt >= 8) {
              reject(
                new Error(`Select dropdown did not open. Make sure the modal is open and the select is available.`),
              );
              return;
            }

            const option = options.find(
              (opt) => opt.textContent?.trim() === optionText.trim()
            );

            if (!option) {
              // Close the select if option not found by pressing Escape
              if (!wasOpen && options.length > 0) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              }
              reject(
                new Error(`Option with text "${optionText}" not found. Available options: ${options.map(o => o.textContent?.trim()).filter(Boolean).join(', ') || 'none'}`),
              );
              return;
            }

            // Click the option - this should trigger onValueChange and close the select
            const optionClickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
            });
            (option as HTMLElement).dispatchEvent(optionClickEvent);
            
            // Wait longer to ensure the select fully closes and state updates
            setTimeout(() => {
              // Verify the select is closed
              const stillOpen = checkIfSelectOpen();
              if (stillOpen) {
                // Force close by pressing Escape
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              }
              resolve({ success: true, selectId, optionText });
            }, 300);
          }, wasOpen ? 50 : 150 * attempt); // Longer delays if we had to open it
        };

        trySelect(1);
      });
    },
    deps: [],
  });

  const runtime = useRuntime({
    functions: [createLight],
  });
  const toolJavaScript = useToolJavaScript({
    runtime,
  });

  // Arrays must be passed as template interpolations, not as literal {[]} text,
  // so the system prompt validator receives real JavaScript arrays.
  const noLightIds: string[] = [];
  const exampleEveningLightIds = ['kitchen-light-id'];
  const exampleOfficeLightIds = ['office-light-id-from-getLights'];

  const {
    messages,
    sendMessage,
    resendMessages,
    isSending,
    isReceiving,
    isRunningToolCalls,
    stop,
  } = useUiChat({
    model: 'gpt-4.1',
    debugName: 'RichChatPanel',
    system: prompt`
      You are a smart home assistant. You can control the lights in the house. 
      You should not stringify (aka escape) function arguments

      Always prefer writing a single script for the javascript tool over calling 
      the javascript tool multiple times.

      ### IMPORTANT: Use Tools for Actions
      When the user asks you to perform an action (delete, update, control), **always use the appropriate tool** (deleteLight, controlLight, etc.) to perform the action directly. Never show buttons for actions you can perform with tools.

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
    tools: [getLights, controlLight, deleteLight, getScenes, deleteScene, setFormInputValue, clickButtonByText, selectOptionByText, toolJavaScript],
    components: [
      exposeComponent(LightChatComponent, {
        name: 'LightChat',
        description: 'A component that lets the user control a light',
        props: {
          lightId: s.string('The id of the light'),
        },
      }),
      exposeComponent(MarkdownComponent, {
        name: 'Markdown',
        description: 'Show markdown content to the user',
        children: 'text',
      }),
      exposeComponent(CardComponent, {
        name: 'Card',
        description: 'Show a card with children components to the user',
        children: 'any',
        props: {
          title: s.string('The title of the card'),
          description: s.streaming.string('The description of the card'),
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
  });

  const isWorking = useMemo(() => {
    return isSending || isReceiving || isRunningToolCalls;
  }, [isSending, isReceiving, isRunningToolCalls]);

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Add state for the textarea input
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]',
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // useEffect(() => {
  //   console.log(messages);
  // }, [messages]);

  const onSubmit = useCallback(() => {
    // Only submit if there's text
    if (!inputValue.trim()) return;

    // Add the user message to the messages list
    const newUserMessage: Chat.UserMessage = {
      role: 'user',
      content: inputValue,
    };

    setInputValue('');

    sendMessage(newUserMessage);
  }, [inputValue, sendMessage, setInputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (but not on Shift+Enter)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent default behavior (new line)
        onSubmit();
      }
    },
    [onSubmit],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
    },
    [],
  );

  const onRetry = useCallback(() => {
    resendMessages();
  }, [resendMessages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-col lg:flex-1">
        <ScrollArea className="max-h-48 lg:flex-1" ref={scrollAreaRef}>
          <div className="flex flex-col gap-2 px-2">
            {messages.map((message, index, array) => (
              <RichMessage
                key={index}
                message={message}
                onRetry={onRetry}
                isLast={index === array.length - 1}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="flex flex-col text-sm text-foreground/50 gap-2 h-6 justify-end px-2">
        {isWorking && <p>Thinking...</p>}
      </div>
      <div className="flex flex-col gap-2 border-border px-2 max-lg:border-t max-lg:pt-2">
        <Textarea
          value={inputValue}
          onChange={onInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
        />
        {!isWorking ? (
          <Button onClick={onSubmit}>Send</Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              stop();
            }}
          >
            Stop
          </Button>
        )}
      </div>
    </div>
  );
};
