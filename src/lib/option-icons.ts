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
