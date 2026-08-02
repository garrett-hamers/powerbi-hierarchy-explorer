export interface LocalizedStrings {
  visualName: string;
  searchLabel: string;
  searchPlaceholder: string;
  selectDescendants: string;
  clearSelection: string;
  received: string;
  visible: string;
  excluded: string;
  noData: string;
  unnamed: string;
  expand: string;
  collapse: string;
  breadcrumb: string;
  diagnostics: string;
  selected: string;
  descendants: string;
  child: string;
  children: string;
  graph: string;
  tree: string;
  label: string;
  nodeId: string;
  parentId: string;
  depth: string;
  childCount: string;
  category: string;
  value: string;
  dataQuality: string;
  sourceRow: string;
  emptySpace: string;
  matrixUnsupported: string;
  boundedContract: string;
  tableMode: string;
  matrixMode: string;
}

const ENGLISH: LocalizedStrings = {
  visualName: "Atlyn Hierarchy Explorer",
  searchLabel: "Search",
  searchPlaceholder: "Find a node",
  selectDescendants: "Select descendants",
  clearSelection: "Clear selection",
  received: "received",
  visible: "visible",
  excluded: "excluded",
  noData: "Add NodeId, ParentId, and Label fields to explore a hierarchy.",
  unnamed: "Unnamed node",
  expand: "Expand",
  collapse: "Collapse",
  breadcrumb: "Path",
  diagnostics: "Data quality",
  selected: "selected",
  descendants: "descendants",
  child: "child",
  children: "children",
  graph: "Graphical hierarchy",
  tree: "Hierarchy tree",
  label: "Label",
  nodeId: "Node ID",
  parentId: "Parent ID",
  depth: "Depth",
  childCount: "Children",
  category: "Category",
  value: "Value",
  dataQuality: "Data quality",
  sourceRow: "Retained table row",
  emptySpace: "Empty visual space",
  matrixUnsupported: "Matrix mode is not enabled. Use the table NodeId, ParentId, and Label roles.",
  boundedContract: "bounded table contract active",
  tableMode: "Table mode",
  matrixMode: "Matrix mode"
};

const TRANSLATIONS: Record<string, Partial<LocalizedStrings>> = {
  es: {
    searchLabel: "Buscar",
    searchPlaceholder: "Buscar un nodo",
    selectDescendants: "Seleccionar descendientes",
    clearSelection: "Borrar selección",
    received: "recibidos",
    visible: "visibles",
    excluded: "excluidos",
    noData: "Agregue NodeId, ParentId y Label para explorar una jerarquía.",
    unnamed: "Nodo sin nombre",
    expand: "Expandir",
    collapse: "Contraer",
    breadcrumb: "Ruta",
    diagnostics: "Calidad de datos",
    selected: "seleccionados",
    descendants: "descendientes",
    child: "hijo",
    children: "hijos"
  },
  fr: {
    searchLabel: "Rechercher",
    searchPlaceholder: "Rechercher un nœud",
    selectDescendants: "Sélectionner les descendants",
    clearSelection: "Effacer la sélection",
    received: "reçus",
    visible: "visibles",
    excluded: "exclus",
    noData: "Ajoutez NodeId, ParentId et Label pour explorer une hiérarchie.",
    unnamed: "Nœud sans nom",
    expand: "Développer",
    collapse: "Réduire",
    breadcrumb: "Chemin",
    diagnostics: "Qualité des données",
    selected: "sélectionnés",
    descendants: "descendants",
    child: "enfant",
    children: "enfants"
  },
  de: {
    searchLabel: "Suchen",
    searchPlaceholder: "Knoten suchen",
    selectDescendants: "Nachfolger auswählen",
    clearSelection: "Auswahl löschen",
    received: "empfangen",
    visible: "sichtbar",
    excluded: "ausgeschlossen",
    noData: "Fügen Sie NodeId, ParentId und Label hinzu, um eine Hierarchie zu erkunden.",
    unnamed: "Unbenannter Knoten",
    expand: "Erweitern",
    collapse: "Reduzieren",
    breadcrumb: "Pfad",
    diagnostics: "Datenqualität",
    selected: "ausgewählt",
    descendants: "Nachfolger",
    child: "Kind",
    children: "Kinder"
  },
  ar: {
    searchLabel: "بحث",
    searchPlaceholder: "البحث عن عقدة",
    selectDescendants: "تحديد الفروع",
    clearSelection: "مسح التحديد",
    received: "مستلمة",
    visible: "مرئية",
    excluded: "مستبعدة",
    noData: "أضف NodeId وParentId وLabel لاستكشاف التسلسل الهرمي.",
    unnamed: "عقدة بلا اسم",
    expand: "توسيع",
    collapse: "طي",
    breadcrumb: "المسار",
    diagnostics: "جودة البيانات",
    selected: "محددة",
    descendants: "الفروع",
    child: "فرع",
    children: "فروع",
    boundedContract: "عقد الجدول المحدود نشط",
    tableMode: "وضع الجدول",
    matrixMode: "وضع المصفوفة"
  }
};

export function getLocaleStrings(locale: string | undefined): LocalizedStrings {
  const language = (locale ?? "en").toLowerCase().split(/[-_]/)[0];
  return { ...ENGLISH, ...(TRANSLATIONS[language] ?? {}) };
}

export function isRtlLocale(locale: string | undefined): boolean {
  const language = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return language === "ar" || language === "he" || language === "fa" || language === "ur";
}
