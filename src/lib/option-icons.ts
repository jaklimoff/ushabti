/**
 * The icons an option may carry, as plain names. Nothing here draws one: the
 * names are what `property_options.icon` stores.
 *
 * The first part is Mnemes' `ICON_CATALOGUE`, verbatim and in its order, so a
 * stored name means the same in every product. Ours are appended after it.
 *
 * **Append-only.** A name is a storage key, not a lucide export name. Remove or
 * rename one and every option that stores it loses its icon in silence, on
 * every board and in every export already written. A name is at most 16
 * characters, as in Mnemes.
 */
export const OPTION_ICONS = [
  "Book",
  "BookOpen",
  "Bookmark",
  "Star",
  "Heart",
  "Home",
  "Settings",
  "Lock",
  "Unlock",
  "Bell",
  "Search",
  "Folder",
  "FolderOpen",
  "File",
  "FileText",
  "Clipboard",
  "Paperclip",
  "PenTool",
  "Pencil",
  "MessageSquare",
  "MessageCircle",
  "Mail",
  "Send",
  "Link",
  "Globe",
  "Map",
  "MapPin",
  "Compass",
  "Clock",
  "Calendar",
  "Sun",
  "Moon",
  "Cloud",
  "Zap",
  "Flame",
  "Droplets",
  "Mountain",
  "TreePine",
  "Flower2",
  "Bug",
  "Shield",
  "Key",
  "Eye",
  "EyeOff",
  "Camera",
  "Image",
  "Video",
  "Music",
  "Headphones",
  "Mic",
  "Monitor",
  "Smartphone",
  "Laptop",
  "Cpu",
  "Database",
  "HardDrive",
  "Wifi",
  "Code",
  "Terminal",
  "GitBranch",
  "Package",
  "Box",
  "Archive",
  "Trash2",
  "Download",
  "Upload",
  "ExternalLink",
  "Share2",
  "Users",
  "User",
  "UserPlus",
  "Crown",
  "Award",
  "Target",
  "Flag",
  "Tag",
  "Hash",
  "AtSign",
  "DollarSign",
  "BarChart3",
  "PieChart",
  "TrendingUp",
  "Activity",
  "CheckCircle",
  "AlertCircle",
  "Info",
  "HelpCircle",
  "ThumbsUp",
  "ThumbsDown",
  "Smile",
  "Frown",
  "Lightbulb",
  "Rocket",
  "Puzzle",
  "Layers",
  "Layout",
  "List",
  "CheckSquare",
  "Circle",
  "Square",
  "Triangle",
  "Hexagon",
  // Ushabti's own, for a status and a priority.
  "SignalZero",
  "SignalLow",
  "SignalMedium",
  "SignalHigh",
  "CircleDashed",
  "CircleDot",
  "CircleDotDashed",
  "CirclePause",
  "CircleX",
  "CircleSlash",
  "Loader",
  "Hourglass",
  "ChevronsUp",
  "ArrowUp",
  "ArrowDown",
  "Minus",
  "OctagonAlert",
  "Ban",
] as const;

export type OptionIcon = (typeof OPTION_ICONS)[number];

const KNOWN: ReadonlySet<string> = new Set(OPTION_ICONS);

export function isOptionIcon(name: unknown): name is OptionIcon {
  return typeof name === "string" && KNOWN.has(name);
}

/**
 * A stored icon, read afresh. A name that is not in the list reads as none,
 * every time; nothing rewrites the row.
 */
export function readOptionIcon(stored: string | null | undefined): OptionIcon | null {
  return isOptionIcon(stored) ? stored : null;
}

/**
 * The icon a write asks for: undefined when it names none, null to clear it,
 * or an error for anything that is not a name in the list.
 */
export function readIconInput(
  input: unknown,
): { icon: OptionIcon | null | undefined } | { error: string } {
  if (input === undefined || input === null) return { icon: input };
  if (isOptionIcon(input)) return { icon: input };
  return { error: "That icon is not one Ushabti knows." };
}

/**
 * The words a person reads for an icon's name: "BookOpen" reads "Book open"
 * and "Flower2" reads "Flower 2". The stored name stays as it is.
 */
export function iconLabel(name: OptionIcon): string {
  const words = name
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The words a search finds an icon by, lowercase. Mnemes' own for its part of
 * the list, so a word finds the same icon in both. Keyed by the name, so an
 * icon added without any does not compile. Unlike the names, these are not
 * stored and may change.
 */
const KEYWORDS: Readonly<Record<OptionIcon, readonly [string, ...string[]]>> = {
  Book: ["book", "read", "library"],
  BookOpen: ["book", "open", "read"],
  Bookmark: ["bookmark", "save", "favorite"],
  Star: ["star", "favorite", "rating"],
  Heart: ["heart", "love", "like"],
  Home: ["home", "house"],
  Settings: ["settings", "gear", "config"],
  Lock: ["lock", "secure", "private"],
  Unlock: ["unlock", "open"],
  Bell: ["bell", "notification", "alert"],
  Search: ["search", "find", "magnify"],
  Folder: ["folder", "directory"],
  FolderOpen: ["folder", "open"],
  File: ["file", "document"],
  FileText: ["file", "text", "document"],
  Clipboard: ["clipboard", "paste", "copy"],
  Paperclip: ["paperclip", "attach"],
  PenTool: ["pen", "draw", "design"],
  Pencil: ["pencil", "edit", "write"],
  MessageSquare: ["message", "chat", "comment"],
  MessageCircle: ["message", "chat", "bubble"],
  Mail: ["mail", "email", "letter"],
  Send: ["send", "share"],
  Link: ["link", "url", "chain"],
  Globe: ["globe", "world", "web"],
  Map: ["map", "location", "navigate"],
  MapPin: ["pin", "location", "place"],
  Compass: ["compass", "direction", "navigate"],
  Clock: ["clock", "time", "schedule"],
  Calendar: ["calendar", "date", "schedule"],
  Sun: ["sun", "light", "day"],
  Moon: ["moon", "night", "dark"],
  Cloud: ["cloud", "weather", "storage"],
  Zap: ["zap", "lightning", "energy", "fast"],
  Flame: ["flame", "fire", "hot"],
  Droplets: ["water", "droplet", "rain"],
  Mountain: ["mountain", "nature", "landscape"],
  TreePine: ["tree", "nature", "forest"],
  Flower2: ["flower", "nature", "plant"],
  Bug: ["bug", "insect", "debug"],
  Shield: ["shield", "protect", "security"],
  Key: ["key", "access", "password"],
  Eye: ["eye", "view", "visible"],
  EyeOff: ["eye", "hide", "invisible"],
  Camera: ["camera", "photo", "image"],
  Image: ["image", "photo", "picture"],
  Video: ["video", "film", "movie"],
  Music: ["music", "audio", "sound"],
  Headphones: ["headphones", "audio", "music"],
  Mic: ["mic", "microphone", "voice"],
  Monitor: ["monitor", "screen", "display"],
  Smartphone: ["phone", "mobile", "device"],
  Laptop: ["laptop", "computer"],
  Cpu: ["cpu", "processor", "chip"],
  Database: ["database", "storage", "data"],
  HardDrive: ["drive", "storage", "disk"],
  Wifi: ["wifi", "internet", "wireless"],
  Code: ["code", "programming", "develop"],
  Terminal: ["terminal", "console", "command"],
  GitBranch: ["git", "branch", "code"],
  Package: ["package", "box", "module"],
  Box: ["box", "container", "package"],
  Archive: ["archive", "storage", "backup"],
  Trash2: ["trash", "delete", "remove"],
  Download: ["download", "save"],
  Upload: ["upload", "share"],
  ExternalLink: ["external", "link", "open"],
  Share2: ["share", "social"],
  Users: ["users", "people", "team", "group"],
  User: ["user", "person", "profile"],
  UserPlus: ["user", "add", "invite"],
  Crown: ["crown", "king", "premium"],
  Award: ["award", "trophy", "prize"],
  Target: ["target", "goal", "aim"],
  Flag: ["flag", "mark", "report"],
  Tag: ["tag", "label", "category"],
  Hash: ["hash", "number", "tag"],
  AtSign: ["at", "email", "mention"],
  DollarSign: ["dollar", "money", "price"],
  BarChart3: ["chart", "bar", "analytics"],
  PieChart: ["chart", "pie", "analytics"],
  TrendingUp: ["trending", "growth", "up"],
  Activity: ["activity", "pulse", "health"],
  CheckCircle: ["check", "done", "complete", "success"],
  AlertCircle: ["alert", "warning", "error"],
  Info: ["info", "information", "help"],
  HelpCircle: ["help", "question", "support"],
  ThumbsUp: ["thumbs", "up", "like", "good"],
  ThumbsDown: ["thumbs", "down", "dislike", "bad"],
  Smile: ["smile", "happy", "face"],
  Frown: ["frown", "sad", "face"],
  Lightbulb: ["lightbulb", "idea", "innovation"],
  Rocket: ["rocket", "launch", "startup"],
  Puzzle: ["puzzle", "piece", "solution"],
  Layers: ["layers", "stack", "design"],
  Layout: ["layout", "grid", "design"],
  List: ["list", "menu", "items"],
  CheckSquare: ["checkbox", "todo", "task"],
  Circle: ["circle", "shape"],
  Square: ["square", "shape"],
  Triangle: ["triangle", "shape"],
  Hexagon: ["hexagon", "shape"],
  SignalZero: ["signal", "priority", "none", "zero"],
  SignalLow: ["signal", "priority", "low"],
  SignalMedium: ["signal", "priority", "medium"],
  SignalHigh: ["signal", "priority", "high"],
  CircleDashed: ["circle", "dashed", "backlog", "draft"],
  CircleDot: ["circle", "dot", "progress", "doing"],
  CircleDotDashed: ["circle", "dot", "dashed", "review"],
  CirclePause: ["circle", "pause", "later", "hold"],
  CircleX: ["circle", "cancel", "close"],
  CircleSlash: ["circle", "slash", "blocked", "skip"],
  Loader: ["loader", "spinner", "progress", "doing"],
  Hourglass: ["hourglass", "wait", "time"],
  ChevronsUp: ["chevrons", "up", "urgent", "priority"],
  ArrowUp: ["arrow", "up", "high", "priority"],
  ArrowDown: ["arrow", "down", "low", "priority"],
  Minus: ["minus", "dash", "medium", "none"],
  OctagonAlert: ["octagon", "alert", "urgent", "warning"],
  Ban: ["ban", "blocked", "forbidden", "stop"],
};

/**
 * The icons a search box finds, in the list's order. Every word typed has to
 * appear in the icon's name or one of its words, so "check" finds four and
 * "check done" one. An empty box finds every icon.
 */
export function findIcons(query: string): OptionIcon[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...OPTION_ICONS];
  return OPTION_ICONS.filter((name) => {
    const hay = [iconLabel(name).toLowerCase(), ...KEYWORDS[name]].join(" ");
    return words.every((word) => hay.includes(word));
  });
}
