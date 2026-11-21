import { encodeFrame } from '@hashbrownai/core';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { countRequestTokens, FrameReader, ReplyTokenCounter, replyTextOfFrame } from './chat-context';

function chunkFrame(content: string | null, args?: string) {
  return {
    type: 'generation-chunk',
    chunk: {
      choices: [
        {
          index: 0,
          delta: {
            content,
            toolCalls: args === undefined ? undefined : [{ index: 0, function: { name: 'proposeGame', arguments: args } }],
          },
          finishReason: null,
        },
      ],
    },
  } as const;
}

describe('countRequestTokens', () => {
  it('splits the system prompt and tool schemas from the conversation', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'getLights',
          description: 'Get the lights',
          parameters: { type: 'object', properties: { room: { type: 'string', description: 'The room' } }, required: ['room'] },
        },
      },
    ];
    const renderedTools =
      '# Tools\n\n## functions\n\nnamespace functions {\n\n' +
      '// Get the lights\ntype getLights = (_: {\n// The room\nroom: string,\n}) => any;' +
      '\n\n} // namespace functions';
    const result = countRequestTokens({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'You are the assistant.' },
        { role: 'user', content: '옛날 옛적에 토끼가 살았어요.' },
        { role: 'assistant', content: null, tool_calls: [{ function: { name: 'getLights', arguments: '{}' } }] },
        { role: 'tool', content: '[{"id":"1"}]' },
      ],
      tools,
    });

    expect(result.fixedTokens).toBe(
      countTokens('You are the assistant.') + 3 + countTokens(renderedTools) + 3,
    );
    expect(result.messageTokens).toBe(
      countTokens('옛날 옛적에 토끼가 살았어요.') +
        3 +
        (countTokens('getLights') + countTokens('{}') + 3) +
        (countTokens('[{"id":"1"}]') + 3),
    );
  });

  it('renders optional properties, enums, arrays and unions like OpenAI does', () => {
    const parameters = {
      type: 'object',
      properties: {
        focus: { type: 'string', enum: ['vocabulary', 'grammar'] },
        ids: { type: 'array', items: { type: 'string' } },
        value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['focus'],
    };
    const result = countRequestTokens({ tools: [{ type: 'function', function: { name: 'pick', parameters } }] });

    expect(result.fixedTokens).toBe(
      countTokens(
        '# Tools\n\n## functions\n\nnamespace functions {\n\n' +
          'type pick = (_: {\nfocus: "vocabulary" | "grammar",\nids?: string[],\nvalue?: string | number,\n}) => any;' +
          '\n\n} // namespace functions',
      ) + 3,
    );
  });

  it('counts a response schema without additionalProperties and required, plus overhead', () => {
    const schema = { type: 'object', properties: { ui: { type: 'string' } }, required: ['ui'], additionalProperties: false };
    const responseFormat = { type: 'json_schema', json_schema: { strict: true, name: 'schema', schema } };
    const withSchema = countRequestTokens({ messages: [], response_format: responseFormat });
    const without = countRequestTokens({ messages: [] });

    expect(withSchema.fixedTokens - without.fixedTokens).toBe(
      countTokens(JSON.stringify({ type: 'object', properties: { ui: { type: 'string' } } })) + 8,
    );
  });

  it('copes with an empty request', () => {
    expect(countRequestTokens({})).toEqual({ fixedTokens: 3, messageTokens: 0 });
  });
});

describe('replyTextOfFrame', () => {
  it('reads content and tool-call arguments from generation chunks', () => {
    expect(replyTextOfFrame(chunkFrame('Hello'))).toBe('Hello');
    expect(replyTextOfFrame(chunkFrame(null, '{"title"'))).toBe('proposeGame{"title"');
  });

  it('ignores other frames', () => {
    expect(replyTextOfFrame({ type: 'generation-start' })).toBe('');
    expect(replyTextOfFrame(null)).toBe('');
  });
});

describe('FrameReader', () => {
  it('reads frames split across chunks and joined in one chunk', () => {
    const a = encodeFrame({ type: 'generation-start' });
    const b = encodeFrame(chunkFrame('안녕') as never);
    const joined = new Uint8Array([...a, ...b]);
    const reader = new FrameReader();

    expect(reader.push(joined.subarray(0, 3))).toEqual([]);
    expect(reader.push(joined.subarray(3, a.length + 5))).toEqual([{ type: 'generation-start' }]);
    expect(reader.push(joined.subarray(a.length + 5))).toEqual([chunkFrame('안녕')]);
  });
});

describe('ReplyTokenCounter', () => {
  it('counts the streamed reply text', () => {
    const counter = new ReplyTokenCounter();
    counter.push(encodeFrame({ type: 'generation-start' }));
    counter.push(encodeFrame(chunkFrame('I made ') as never));
    counter.push(encodeFrame(chunkFrame('a game.') as never));

    expect(counter.tokens).toBe(countTokens('I made a game.'));
  });
});
