/**
 * Base IRI and actor format are locked in docs/xAPI/LRS.md once pilot
 * statements exist — do not change (xapi-export-plan.md: "effectively
 * permanent"). Kept in a dependency-free module so both the statement
 * builder and the Leitner code can import it without a cycle.
 */
export const XAPI_BASE_IRI = 'https://kogs.link/xapi/emoji-app';
export const XAPI_HOMEPAGE = 'https://kogs.link';

export const ANSWERED_VERB_ID = 'http://adlnet.gov/expapi/verbs/answered';
