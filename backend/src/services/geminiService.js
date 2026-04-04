const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Large fallback pool per category so repeats are rare even without Gemini
const FALLBACKS = {
  general:     [['Guitar','Ukulele'],['Coffee','Tea'],['Tiger','Leopard'],['Soccer','Rugby'],['Piano','Keyboard'],['Salmon','Trout'],['Tulip','Rose'],['Laptop','Tablet'],['Doctor','Nurse'],['Cinema','Theatre'],['Bus','Tram'],['Hotel','Motel'],['Chef','Cook'],['Painting','Drawing'],['River','Stream']],
  animals:     [['Tiger','Leopard'],['Dolphin','Porpoise'],['Rabbit','Hare'],['Crocodile','Alligator'],['Moth','Butterfly'],['Crow','Raven'],['Donkey','Mule'],['Seal','Sea Lion'],['Cheetah','Jaguar'],['Pigeon','Dove'],['Llama','Alpaca'],['Frog','Toad'],['Wasp','Bee'],['Ferret','Weasel'],['Elk','Moose']],
  food:        [['Coffee','Espresso'],['Burger','Sandwich'],['Pizza','Flatbread'],['Sushi','Sashimi'],['Latte','Cappuccino'],['Pancake','Waffle'],['Jam','Marmalade'],['Croissant','Brioche'],['Noodles','Pasta'],['Cookie','Biscuit'],['Smoothie','Milkshake'],['Taco','Burrito'],['Muffin','Cupcake'],['Donut','Bagel'],['Curry','Stew']],
  sports:      [['Soccer','Rugby'],['Tennis','Squash'],['Swimming','Diving'],['Cycling','Triathlon'],['Boxing','Wrestling'],['Volleyball','Handball'],['Skiing','Snowboarding'],['Surfing','Wakeboarding'],['Cricket','Baseball'],['Golf','Frisbee Golf'],['Karate','Taekwondo'],['Rowing','Kayaking'],['Fencing','Archery'],['Polo','Hockey'],['Marathon','Triathlon']],
  music:       [['Guitar','Ukulele'],['Piano','Keyboard'],['Drum','Bongo'],['Violin','Viola'],['Trumpet','Trombone'],['Flute','Recorder'],['Bass','Cello'],['Harp','Lyre'],['Sitar','Banjo'],['Clarinet','Oboe'],['Accordion','Concertina'],['Saxophone','Clarinet'],['Xylophone','Marimba'],['Harmonica','Kazoo'],['Mandolin','Lute']],
  movies:      [['Horror','Thriller'],['Comedy','Satire'],['Drama','Melodrama'],['Sequel','Remake'],['Director','Producer'],['Trailer','Teaser'],['Actor','Performer'],['Premiere','Release'],['Studio','Production'],['Screenplay','Script'],['Blockbuster','Indie'],['Cameo','Appearance'],['Franchise','Series'],['Animation','Cartoon'],['Documentary','Biopic']],
  technology:  [['Laptop','Tablet'],['WiFi','Bluetooth'],['App','Software'],['Robot','Drone'],['Browser','Search Engine'],['Podcast','Webinar'],['Coding','Programming'],['Server','Cloud'],['Pixel','Resolution'],['Firewall','Antivirus'],['Algorithm','Formula'],['Streaming','Downloading'],['Plugin','Extension'],['Keyboard','Trackpad'],['Backup','Archive']],
  nature:      [['River','Stream'],['Volcano','Geyser'],['Forest','Jungle'],['Desert','Wasteland'],['Mountain','Hill'],['Cave','Cavern'],['Glacier','Iceberg'],['Waterfall','Cascade'],['Canyon','Gorge'],['Swamp','Marsh'],['Meadow','Prairie'],['Cliff','Bluff'],['Lagoon','Lake'],['Reef','Shoal'],['Storm','Typhoon']],
  history:     [['King','Emperor'],['Castle','Fortress'],['Knight','Warrior'],['Revolution','Rebellion'],['Dynasty','Empire'],['Treaty','Accord'],['Pharaoh','Sultan'],['Catapult','Trebuchet'],['Colony','Territory'],['Gladiator','Soldier'],['Scroll','Manuscript'],['Throne','Crown'],['Siege','Blockade'],['Relic','Artifact'],['Monument','Shrine']],
  geography:   [['Country','Nation'],['Capital','Metropolis'],['Ocean','Sea'],['Continent','Landmass'],['Peninsula','Isthmus'],['Archipelago','Atoll'],['Plateau','Mesa'],['Strait','Channel'],['Valley','Basin'],['Delta','Estuary'],['Tundra','Taiga'],['Equator','Tropic'],['Border','Frontier'],['Bay','Gulf'],['Fjord','Inlet']],
  science:     [['Atom','Molecule'],['Gravity','Magnetism'],['Telescope','Microscope'],['Hypothesis','Theory'],['Experiment','Trial'],['Element','Compound'],['Nucleus','Core'],['Photon','Electron'],['Vaccine','Antidote'],['Fossil','Relic'],['Orbit','Trajectory'],['Enzyme','Catalyst'],['Mutation','Variation'],['Neutron','Proton'],['Prism','Lens']],
  mythology:   [['Dragon','Griffin'],['Zeus','Jupiter'],['Vampire','Werewolf'],['Mermaid','Siren'],['Phoenix','Pegasus'],['Thor','Odin'],['Minotaur','Centaur'],['Unicorn','Alicorn'],['Poseidon','Neptune'],['Wizard','Sorcerer'],['Cyclops','Giant'],['Sphinx','Chimera'],['Valkyrie','Warrior Goddess'],['Goblin','Gremlin'],['Elf','Faerie']],
  fashion:     [['Jacket','Blazer'],['Sneakers','Trainers'],['Scarf','Shawl'],['Boots','Loafers'],['Handbag','Clutch'],['Jeans','Trousers'],['Hoodie','Sweatshirt'],['Necklace','Pendant'],['Sunglasses','Goggles'],['Cardigan','Pullover'],['Skirt','Dress'],['Cap','Beanie'],['Belt','Suspenders'],['Gloves','Mittens'],['Earrings','Studs']],
  space:       [['Star','Sun'],['Planet','Moon'],['Asteroid','Meteorite'],['Galaxy','Nebula'],['Astronaut','Cosmonaut'],['Rocket','Spacecraft'],['Orbit','Revolution'],['Telescope','Observatory'],['Comet','Asteroid'],['Gravity','Magnetism'],['Satellite','Space Station'],['Eclipse','Transit'],['Supernova','Pulsar'],['Wormhole','Black Hole'],['Mars','Venus']],
  emotions:    [['Happy','Joyful'],['Sad','Melancholy'],['Angry','Furious'],['Scared','Anxious'],['Surprised','Shocked'],['Jealous','Envious'],['Proud','Confident'],['Shy','Nervous'],['Bored','Restless'],['Excited','Thrilled'],['Guilty','Ashamed'],['Disgusted','Repulsed'],['Lonely','Isolated'],['Hopeful','Optimistic'],['Confused','Puzzled']],
  occupations: [['Doctor','Nurse'],['Chef','Cook'],['Pilot','Captain'],['Lawyer','Attorney'],['Teacher','Tutor'],['Engineer','Technician'],['Artist','Painter'],['Writer','Author'],['Journalist','Reporter'],['Architect','Designer'],['Firefighter','Paramedic'],['Scientist','Researcher'],['Carpenter','Woodworker'],['Librarian','Archivist'],['Mechanic','Technician']],
  games:       [['Chess','Checkers'],['Poker','Blackjack'],['Monopoly','Risk'],['Darts','Billiards'],['Jigsaw','Puzzle'],['Bowling','Skittles'],['Hide and Seek','Tag'],['Scrabble','Boggle'],['Uno','Skip-Bo'],['Bingo','Lotto'],['Dominoes','Mahjong'],['Charades','Pictionary'],['Jenga','Tower Game'],['Backgammon','Parcheesi'],['Badminton','Tennis']],
};

// Track recently used pairs per session to avoid repeats
const recentlyUsed = new Set();

const getRandomFallback = (category) => {
  const pool = FALLBACKS[category] || FALLBACKS.general;
  // Filter out recently used
  const available = pool.filter(([a, b]) => !recentlyUsed.has(`${a}-${b}`));
  const list = available.length > 0 ? available : pool;
  const [a, b] = list[Math.floor(Math.random() * list.length)];
  recentlyUsed.add(`${a}-${b}`);
  if (recentlyUsed.size > 30) recentlyUsed.delete(recentlyUsed.values().next().value);
  return { innocentWord: a, imposterWord: b };
};

const generateGameWords = async (category = 'general') => {
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('No API key');

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const seed = Math.floor(Math.random() * 10000);

    const prompt = `You are generating word pairs for an "Imposter" social deduction party game. Seed: ${seed}

CATEGORY: ${category}

RULES:
- Generate ONE pair of words from the "${category}" category specifically
- Innocent players get word1, imposter players get word2
- Both words MUST clearly belong to the "${category}" category
- Words must be similar enough that players can't immediately spot the imposter
- Words must be different enough that a careful observer can detect them
- Good examples by category:
  animals: (Dolphin / Porpoise), (Crow / Raven), (Alligator / Crocodile)
  food: (Latte / Cappuccino), (Pancake / Waffle), (Taco / Burrito)
  sports: (Tennis / Squash), (Skiing / Snowboarding), (Boxing / Wrestling)
  music: (Violin / Viola), (Trumpet / Trombone), (Drum / Bongo)
- Pick something DIFFERENT from these examples — be creative and vary your choices
- Single common words only, no phrases

Reply ONLY with this exact JSON (no markdown, no explanation):
{"innocentWord": "word1", "imposterWord": "word2"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);

    if (!parsed.innocentWord || !parsed.imposterWord) throw new Error('Bad format');

    // Log success for debugging
    console.log(`[Gemini] Generated: ${parsed.innocentWord} / ${parsed.imposterWord} (${category})`);
    return { innocentWord: parsed.innocentWord, imposterWord: parsed.imposterWord };

  } catch (err) {
    console.error('[Gemini] Error — using fallback:', err.message);
    return getRandomFallback(category);
  }
};

module.exports = { generateGameWords };
