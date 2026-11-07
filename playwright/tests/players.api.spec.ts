import { expect, test } from '../fixtures/game';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('POST /api/players creates a player with a random external ID and a Player label', async ({
  api,
  games,
}) => {
  const firstName = games.name('Mia');
  const response = await api.request.post('/api/players', { data: { firstName } });

  expect(response.status()).toBe(201);
  const { player } = (await response.json()) as {
    player: { id: string; firstName: string; externalId: string; label: string };
  };
  expect(player.firstName).toBe(firstName);
  expect(player.externalId).toMatch(UUID_V4);
  expect(player.label).toBe(`Player ${player.externalId.slice(0, 4).toUpperCase()}`);

  const list = (await (await api.request.get('/api/players')).json()) as {
    players: Array<{ id: string }>;
  };
  expect(list.players.map((p) => p.id)).toContain(player.id);
});

test('POST /api/players rejects an email (no identifying fields, D4)', async ({ api, games }) => {
  const response = await api.request.post('/api/players', {
    data: { firstName: games.name('Mia'), email: 'mia@example.com' },
  });
  expect(response.status()).toBe(400);
});

test('POST /api/players rejects any extra field', async ({ api, games }) => {
  const response = await api.request.post('/api/players', {
    data: { firstName: games.name('Mia'), surname: 'Smith' },
  });
  expect(response.status()).toBe(400);
});
