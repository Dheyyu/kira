// Static layout of the office and the agent roster. Positions are world-space [x, z].

export const STATIONS = [
  { id: 'scout', name: 'Scout', kind: 'desk', pos: [-9, -7], color: '#3dff7a' },
  { id: 'builder', name: 'Builder', kind: 'desk', pos: [0, -7], color: '#4da6ff' },
  { id: 'outreach', name: 'Outreach', kind: 'desk', pos: [9, -7], color: '#ff8c42' },
  { id: 'lab', name: 'Skills Lab', kind: 'lab', pos: [0, 7], color: '#d946ef' },
];

export const AGENTS = [
  {
    id: 'scout',
    name: 'Scout',
    desk: 'scout',
    color: '#3dff7a',
    role: 'Research and discovery. You find information, leads, and opportunities, and report them clearly with sources or reasoning.',
    keywords: ['research', 'find', 'search', 'look up', 'investigate', 'compare', 'discover', 'lead', 'market', 'competitor', 'trend', 'analyze'],
  },
  {
    id: 'builder',
    name: 'Builder',
    desk: 'builder',
    color: '#4da6ff',
    role: 'Engineering. You write, review, and debug code and design systems. Give working code and brief explanations.',
    keywords: ['build', 'code', 'implement', 'fix', 'bug', 'script', 'function', 'api', 'deploy', 'refactor', 'sql', 'app', 'website', 'test', 'design', 'architecture', 'system', 'migration', 'database'],
  },
  {
    id: 'outreach',
    name: 'Outreach',
    desk: 'outreach',
    color: '#ff8c42',
    role: 'Communication. You draft emails, social posts, pitches, and follow-ups in a clear, human voice.',
    keywords: ['email', 'post', 'tweet', 'message', 'reply', 'pitch', 'outreach', 'linkedin', 'follow up', 'follow-up', 'newsletter', 'copy', 'announce'],
  },
];

export const WALK_SPEED = 2.4; // world units per second
export const TICK_MS = 100;
export const BROADCAST_MS = 200;
