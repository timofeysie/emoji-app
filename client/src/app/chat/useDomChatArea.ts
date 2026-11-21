import { s } from '@hashbrownai/core';
import { useTool } from '@hashbrownai/react';
import type { ChatArea } from './chat-area';

/**
 * DOM interaction tools: fill inputs, click buttons and pick select options in
 * an open dialog. Each area's prompt says which ids and labels to use.
 */
export function useDomChatArea(): ChatArea {
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

  return {
    tools: [setFormInputValue, clickButtonByText, selectOptionByText],
  };
}
