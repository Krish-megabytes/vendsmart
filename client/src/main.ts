import './style.css'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type User = { _id: string; name: string; email: string; role: 'CUSTOMER' | 'OPERATOR' | 'ADMIN'; token: string; operatorRequestStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' }
type Account = { _id: string; name: string; email: string; role: User['role']; banned: boolean; bannedAt: string | null; operatorRequestStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'; operatorRequestedAt?: string | null; createdAt: string }
type Machine = { _id: string; name: string; code: string; address: string; description: string; status: string; capacity?: number; lastHeartbeat?: string; vendor?: { _id?: string; name: string } | string | null; location?: { coordinates: number[] }; availableUnits?: number; topProduct?: { name: string; price: number; originalPrice?: number; discountPercent?: number; expirationDate?: string | null; available: number } }
type ForecastRow = { inventoryId: string; periodDays: number; unitsSold: number; dailyAverage: number; daysRemaining: number | null; suggestedRestock: number; machine: Machine; product: Product }
type Product = { _id: string; name: string; sku: string; category: string; description: string; price: number; originalPrice?: number; discountPercent?: number; expirationDate?: string | null; expired?: boolean; image: string; tags: string[]; available?: number; active?: boolean }
type Reservation = { _id: string; code: string; status: string; total: number; createdAt: string; otp?: string; pickupOtp?: string; paymentMethod?: string; paymentReference?: string; paymentLast4?: string; machine?: Machine; items?: { product?: string; name: string; quantity: number; unitPrice?: number }[] }
type Complaint = { _id: string; reference: string; category: string; subject: string; message: string; status: 'OPEN' | 'RESOLVED'; response?: string; createdAt: string; resolvedAt?: string; reservation?: { _id: string; code: string; status: string; total: number } | string; machine?: { name: string; code?: string } | string; customer?: { name: string; email: string } }
type ProductSuggestion = { _id: string; name: string; category: string; details: string; votes: number; voted: boolean; status: 'OPEN' | 'ADDED'; product?: { _id: string; name: string; sku: string } | null; createdAt: string }
type AdminAuditEntry = { _id: string; actorName: string; actorEmail: string; action: string; targetType: string; targetId: string; targetLabel: string; changes: Record<string, unknown>; createdAt: string }
type PaymentDraft = { machineId: string; items: { productId: string; quantity: number; name: string; price: number }[] }
const ADMIN_VIEWS = ['admin-requests', 'admin-users', 'admin-operators', 'admin-machines', 'admin-assignment', 'admin-support', 'admin-audit'] as const
type AdminView = typeof ADMIN_VIEWS[number]
const VENDOR_VIEWS = ['vendor-machines', 'vendor-products', 'vendor-inventory', 'vendor-sales', 'vendor-orders', 'vendor-suggestions', 'vendor-alerts', 'vendor-support'] as const
type VendorView = typeof VENDOR_VIEWS[number]
type View = 'store' | 'orders' | 'operations' | 'accounts' | 'payment' | 'support' | 'suggestions' | AdminView | VendorView
type InventoryRow = { _id: string; quantity: number; reserved: number; available?: number; lowStockThreshold: number; slot?: string; expirationDate?: string | null; discountPercent?: number; machine: Machine; product: Product }
type Alert = { _id: string; type: string; severity: string; message: string; machine?: Machine; product?: Product; createdAt: string }
type Overview = { machines: { total: number; online: number }; inventory: { rows: number; lowStock: number }; alerts: Alert[]; sales30d: number; revenue30d: number; recentOrders: Reservation[]; salesTrend: { date: string; sales: number; revenue: number }[]; topProducts: { name: string; units: number; revenue: number }[]; machineAttendance: { _id: string; name: string; code: string; address?: string; status: string; capacity: number; vendor: { name: string } | null; onlineOrdersToday: number; revenueToday: number; utilization: number }[]; recommendations: { inventoryId: string; machine: Machine; product: Product; available: number; threshold: number; dailyAverage: number; daysRemaining: number | null; suggestedRestock: number }[] }
type ApiResponse<T> = { success: boolean; data: T; error?: { message: string; code: string } }
type Recommendation = { product: Product; available?: number; score: number }
type RecommendationResponse = { intent: { categories: string[]; tags: string[]; maxPrice?: number; words: string[] }; recommendations: Recommendation[] }

const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')).replace(/\/$/, '')
const STORAGE_KEY = 'vendsmart.session.v1'
const COMPLAINT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'ORDER', label: 'Problem with an order or pickup' },
  { value: 'PAYMENT', label: 'Payment or refund issue' },
  { value: 'MACHINE', label: 'The machine did not work' },
  { value: 'OTHER', label: 'Something else' },
]
const SUGGESTION_OPTIONS: { category: string; items: string[] }[] = [
  { category: 'Chips & snacks', items: ['Lay’s Classic Salted', 'Lay’s India’s Magic Masala', 'Lay’s Spanish Tomato Tango', 'Lay’s American Style Cream & Onion', 'Lay’s Chile Limon', 'Lay’s Maxx Macho Chilli', 'Kurkure Masala Munch', 'Kurkure Naughty Tomato', 'Bingo! Mad Angles Achaari Masti', 'Doritos Nacho Cheese', 'Pringles Original', 'Salted peanuts'] },
  { category: 'Cold drinks', items: ['Coca-Cola', 'Pepsi', 'Sprite', 'Thums Up', 'Fanta Orange', 'Mountain Dew', 'Limca', '7UP', 'Appy Fizz', 'Cold coffee', 'Iced tea', 'Bottled water'] },
  { category: 'Sweets & biscuits', items: ['Cadbury Dairy Milk', 'KitKat', 'Snickers', 'Oreo cookies', 'Hide & Seek biscuits', 'Good Day biscuits', 'Energy bar'] },
]
const viewFromHash = (): View => {
  const hash = location.hash.slice(1)
  if (hash === 'admin-suggestions') return 'store'
  const adminView = ADMIN_VIEWS.find(view => view === hash)
  if (adminView) return adminView
  const vendorView = VENDOR_VIEWS.find(view => view === hash)
  if (vendorView) return vendorView
  return hash.includes('accounts') ? 'accounts' : hash.includes('operations') ? 'operations' : hash.includes('payment') ? 'payment' : hash.includes('support') ? 'support' : hash.includes('suggestions') ? 'suggestions' : hash.includes('orders') ? 'orders' : 'store'
}
type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD' | 'AUD'
// Catalog and order totals are stored in USD. These indicative rates convert them
// for display only, so switching currency never rewrites stored prices.
const CURRENCIES: { code: CurrencyCode; name: string; rate: number; digits: number; locale: string }[] = [
  { code: 'INR', name: 'Indian rupee', rate: 88.4, digits: 0, locale: 'en-IN' },
  { code: 'USD', name: 'US dollar', rate: 1, digits: 2, locale: 'en-US' },
  { code: 'EUR', name: 'Euro', rate: 0.92, digits: 2, locale: 'de-DE' },
  { code: 'GBP', name: 'British pound', rate: 0.79, digits: 2, locale: 'en-GB' },
  { code: 'AED', name: 'UAE dirham', rate: 3.67, digits: 2, locale: 'en-AE' },
  { code: 'SGD', name: 'Singapore dollar', rate: 1.34, digits: 2, locale: 'en-SG' },
  { code: 'AUD', name: 'Australian dollar', rate: 1.54, digits: 2, locale: 'en-AU' },
]
const CURRENCY_KEY = 'vendsmart.currency.v1'
const restoreCurrency = (): CurrencyCode => {
  const saved = localStorage.getItem(CURRENCY_KEY) as CurrencyCode | null
  return CURRENCIES.some(row => row.code === saved) ? saved as CurrencyCode : 'INR'
}
const icon = (name: string, size = 18) => {
  const paths: Record<string, string> = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.2a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    spark: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1 1-2.5Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4 1.4-1.1a7.3 7.3 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4-1.4 1.1a7.3 7.3 0 0 1 0 2Z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
    coffee: '<path d="M10 2v2m4-2v2m-9 4h14l-1 10a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3L5 8Zm14 2h2a2 2 0 0 1 0 4h-2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1Z"/>',
    repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4"/><path d="M12 17.5h.01"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    wifi: '<path d="M2.5 8.5a15 15 0 0 1 19 0"/><path d="M5.5 12a11 11 0 0 1 13 0"/><path d="M8.5 15.5a7 7 0 0 1 7 0"/><path d="M12 19h.01"/>',
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
const imageFor = (product: Product) => product.image?.startsWith('http') ? `<img src="${escapeHtml(product.image)}" alt="" loading="lazy">` : `<span>${escapeHtml(product.image || '��')}</span>`
const machineLatLng = (machine: Machine): [number, number] | null => {
  const coordinates = machine.location?.coordinates
  if (!coordinates || coordinates.length !== 2) return null
  const [lng, lat] = coordinates
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}
const distanceMeters = (from: [number, number], to: [number, number]) => {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const dLat = radians(to[0] - from[0])
  const dLng = radians(to[1] - from[1])
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
const formatDistance = (meters: number) => meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`
// Chandigarh University, Gharuan — fallback centre when no machine has coordinates yet.
const CAMPUS_CENTER: [number, number] = [30.7692, 76.5755]
const walkingDirectionsUrl = (from: [number, number], to: [number, number]) => `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${encodeURIComponent(`${from[0]},${from[1]};${to[0]},${to[1]}`)}`
const describeRouteStep = (step: { distance?: number; name?: string; maneuver?: { type?: string; modifier?: string } }) => {
  const type = step.maneuver?.type || ''
  const modifier = step.maneuver?.modifier || ''
  const street = step.name ? ` onto ${step.name}` : ''
  const distance = step.distance ? ` · ${formatDistance(step.distance)}` : ''
  if (type === 'arrive') return `Arrive at the machine${distance}`
  if (type === 'depart') return `Start walking${street}${distance}`
  if (modifier.includes('left')) return `Turn left${street}${distance}`
  if (modifier.includes('right')) return `Turn right${street}${distance}`
  if (type === 'roundabout' || type === 'rotary') return `Take the roundabout${street}${distance}`
  if (type === 'merge' || modifier === 'straight') return `Keep straight${street}${distance}`
  return `Continue${street}${distance}`
}

class VendSmartApp {
  private user: User | null = this.restoreUser()
  private adminUsers: Account[] = []
  private adminUsersLoaded = false
  private adminAuditLog: AdminAuditEntry[] = []
  private adminSearch = ''
  private machines: Machine[] = []
  private products: Product[] = []
  private catalogProducts: Product[] = []
  private reservations: Reservation[] = []
  private inventory: InventoryRow[] = []
  private overview: Overview | null = null
  private salesRange: 7 | 30 = 7
  private forecast: ForecastRow[] = []
  private selectedMachine = ''
  private category = 'All items'
  private search = ''
  private cart = new Map<string, number>()
  private view: View = viewFromHash()
  private complaints: Complaint[] = []
  private suggestions: ProductSuggestion[] = []
  private paymentDraft: PaymentDraft | null = null
  private paymentReservation: Reservation | null = null
  private paymentMethod: 'CARD' | 'UPI' = 'CARD'
  private complaintOrder = ''
  private contentsMachine: Machine | null = null
  private contentsItems: Product[] | null = null
  private currency: CurrencyCode = restoreCurrency()
  private moneyFormats = new Map<string, Intl.NumberFormat>()
  private busy = false
  private searchTimer = 0
  private prompt = ''
  private recommendations: Recommendation[] = []
  private favorites = new Set<string>()
  private routeSteps: string[] = []
  private arrived = false
  private machineMap: L.Map | null = null
  private machineMarkers = new Map<string, L.Marker>()
  private userLocation: { lat: number; lng: number; accuracy: number } | null = null
  private locationStatus = 'Use your location to sort machines by distance.'
  private pickupMap: L.Map | null = null
  private pickupMachine: Machine | null = null
  private pickupWatchId: number | null = null
  private pickupRoute: L.Polyline | null = null
  private pickupUserMarker: L.CircleMarker | null = null
  private pickupTargetMarker: L.Marker | null = null
  private pickupMapFitted = false
  private pickupStatus = 'Start live location on this page to follow your route.'
  private routeDistance = 'Waiting for your location'
  private routeController: AbortController | null = null
  private lastRouteOrigin: [number, number] | null = null
  private lastRouteRequestedAt = 0
  private expirationTimer: number | null = null

  constructor() {
    this.render()
    void this.load()
    window.addEventListener('popstate', () => { this.view = viewFromHash(); this.render() })
    window.addEventListener('keydown', this.globalKeyHandler)
  }

  private restoreUser(): User | null {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as User | null } catch { return null }
  }

  private currencyRow() {
    return CURRENCIES.find(row => row.code === this.currency) || CURRENCIES[0]
  }

  /** Formats a stored USD amount in the currency the customer picked. */
  private money(amount: number) {
    const row = this.currencyRow()
    let formatter = this.moneyFormats.get(row.code)
    if (!formatter) {
      formatter = new Intl.NumberFormat(row.locale, { style: 'currency', currency: row.code, minimumFractionDigits: row.digits, maximumFractionDigits: row.digits })
      this.moneyFormats.set(row.code, formatter)
    }
    return formatter.format(amount * row.rate)
  }

  private currencyRateNote() {
    const row = this.currencyRow()
    return row.rate === 1 ? '' : `1 USD ≈ ${row.rate} ${row.code}`
  }

  // The recommendation parser matches USD budgets, so translate what the customer typed.
  private promptInBaseCurrency() {
    const rate = this.currencyRow().rate
    if (rate === 1) return this.prompt
    return this.prompt.replace(/(under|below|less than|up to|max(?:imum)?)\s*(?:₹|\$|€|£|rs\.?)?\s*(\d+(?:\.\d{1,2})?)/gi, (_match, lead: string, value: string) => `${lead} $${(Number(value) / rate).toFixed(2)}`)
  }

  private setCurrency(code: CurrencyCode) {
    if (code === this.currency) return
    this.currency = code
    localStorage.setItem(CURRENCY_KEY, code)
    this.render()
    this.toast(`Prices now shown in ${this.currencyRow().name} (${code}).`, 'success')
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(this.user?.token ? { Authorization: `Bearer ${this.user.token}` } : {}), ...(options.headers || {}) },
    })
    const result = await response.json().catch(() => ({ success: false, error: { message: 'The API returned an invalid response.' } })) as ApiResponse<T>
    if (!response.ok || !result.success) {
      if (this.user && (response.status === 401 || (response.status === 403 && result.error?.code === 'ACCOUNT_BANNED'))) this.setUser(null, false)
      throw new Error(result.error?.message || 'Unable to complete your request.')
    }
    return result.data
  }

  private async load() {
    const tasks: { label: string; promise: Promise<unknown> }[] = [
      { label: 'machines', promise: this.request<Machine[]>('/machines').then(rows => { this.machines = rows; if (!this.selectedMachine && rows.length) this.selectedMachine = rows.find(row => row.status === 'ONLINE')?._id || rows[0]._id }) },
      { label: 'orders', promise: this.request<Reservation[]>('/reservations').then(rows => { this.reservations = rows }) },
      { label: 'product suggestions', promise: this.request<ProductSuggestion[]>(`/suggestions${this.user && ['ADMIN', 'OPERATOR'].includes(this.user.role) ? '?status=OPEN' : ''}`).then(rows => { this.suggestions = rows }) },
      ...(this.user ? [
        { label: 'favorites', promise: this.request<Product[]>('/favorites').then(rows => { this.favorites = new Set(rows.map(row => row._id)) }) },
        { label: 'support requests', promise: this.request<Complaint[]>('/complaints').then(rows => { this.complaints = rows }) },
      ] : []),
    ]
    if (this.user && ['ADMIN', 'OPERATOR'].includes(this.user.role)) tasks.push(
      { label: 'inventory', promise: this.request<InventoryRow[]>('/inventory').then(rows => { this.inventory = rows }) },
      { label: 'catalog', promise: this.request<Product[]>('/products').then(rows => { this.catalogProducts = rows }) },
      { label: 'forecast', promise: this.request<ForecastRow[]>('/forecast?days=30').then(rows => { this.forecast = rows }) },
      { label: 'operations overview', promise: this.request<Overview>('/overview').then(data => { this.overview = data }) },
    )
    if (this.user?.role === 'ADMIN') tasks.push(
      { label: 'customer and operator accounts', promise: this.request<Account[]>('/users').then(rows => { this.adminUsers = rows; this.adminUsersLoaded = true }) },
    )
    if (this.user?.role === 'ADMIN' && this.view === 'admin-audit') tasks.push(
      { label: 'admin audit log', promise: this.request<AdminAuditEntry[]>('/users/audit-log').then(rows => { this.adminAuditLog = rows }) },
    )
    const results = await Promise.allSettled(tasks.map(task => task.promise))
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [`${tasks[index].label}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`]
      : [])
    if (failures.length) this.toast(`Some data could not be loaded. ${failures.join('; ')}`, 'error')
    await this.loadProducts()
    this.setRouteTarget(this.activeOrder())
    if (!this.pickupMachine && this.pickupWatchId !== null) this.stopRouteWatch()
    this.render()
  }

  private async loadRecommendations() {
    if (!this.prompt) { this.recommendations = []; this.render(); return }
    try {
      const params = new URLSearchParams({ prompt: this.promptInBaseCurrency() })
      if (this.selectedMachine) params.set('machineId', this.selectedMachine)
      const result = await this.request<RecommendationResponse>(`/recommendations?${params.toString()}`)
      this.recommendations = result.recommendations
      this.render()
      if (!result.recommendations.length) this.toast('No exact matches — try a broader wish.', 'info')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async loadProducts() {
    try {
      const params = new URLSearchParams()
      if (this.selectedMachine) params.set('machineId', this.selectedMachine)
      if (this.search.trim()) params.set('search', this.search.trim())
      this.products = await this.request<Product[]>(`/products?${params.toString()}`)
      this.scheduleExpirationRefresh()
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private scheduleExpirationRefresh() {
    if (this.expirationTimer !== null) window.clearTimeout(this.expirationTimer)
    const expirations = this.products
      .filter(product => product.expirationDate && !product.expired)
      .map(product => new Date(`${product.expirationDate}T23:59:59.999Z`).getTime())
      .filter(timestamp => timestamp > Date.now())
    if (!expirations.length) { this.expirationTimer = null; return }
    this.expirationTimer = window.setTimeout(async () => {
      await this.loadProducts()
      let removedExpiredItem = false
      for (const product of this.products) {
        if (product.expired && this.cart.delete(product._id)) removedExpiredItem = true
      }
      this.render()
      if (removedExpiredItem) this.toast('An expired item was removed from your bag.', 'info')
    }, Math.min(2147483647, Math.min(...expirations) - Date.now() + 10))
  }

  private setUser(user: User | null, reload = true) {
    this.user = user
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user)); else { sessionStorage.removeItem(STORAGE_KEY); this.favorites.clear(); this.suggestions = this.suggestions.map(suggestion => ({ ...suggestion, voted: false })); this.arrived = false }
    this.view = user && ['ADMIN', 'OPERATOR'].includes(user.role) ? 'operations' : 'store'
    if (location.hash.slice(1) !== this.view) location.hash = this.view
    if (reload) void this.load()
    else this.render()
  }

  private render() {
    this.machineMap?.remove()
    this.machineMap = null
    this.machineMarkers.clear()
    if (VENDOR_VIEWS.includes(this.view as VendorView) && this.user?.role !== 'OPERATOR') {
      this.view = this.user?.role === 'ADMIN' ? 'operations' : 'store'
      if (location.hash.slice(1) !== this.view) location.hash = this.view
    }
    const app = document.querySelector<HTMLDivElement>('#app')!
    const staff = Boolean(this.user && ['ADMIN', 'OPERATOR'].includes(this.user.role))
    const openComplaints = this.complaints.filter(complaint => complaint.status === 'OPEN').length
    const adminView = this.user?.role === 'ADMIN' && (this.view === 'operations' || this.view === 'accounts' || ADMIN_VIEWS.some(view => view === this.view))
    const operatorPage = this.user?.role === 'OPERATOR' && VENDOR_VIEWS.includes(this.view as VendorView)
    const content = adminView ? this.renderAdminDashboard() : operatorPage ? this.renderVendorPage(this.view as VendorView) : this.view === 'operations' ? this.renderOperationsPanel() : this.view === 'accounts' ? this.renderAccountsPanel() : this.view === 'orders' ? this.renderOrders() : this.view === 'payment' ? this.renderPayment() : this.view === 'support' ? this.renderSupport() : this.view === 'suggestions' ? this.renderSuggestionBoard() : this.renderStore()
    app.innerHTML = `


      <div class="app-shell ${adminView ? 'admin-shell' : ''} ${staff ? 'staff-shell' : ''} ${this.user?.role === 'OPERATOR' ? 'operator-shell' : ''}">
        <aside class="sidebar">
          <a class="brand" href="#store" aria-label="VendSmart home"><span class="brand-mark">${icon('coffee', 23)}</span><span class="brand-name">vend<span>smart</span><small>SMART VENDING, BETTER DAYS</small></span></a>
          <div class="workspace-label">WORKSPACE</div>
          <nav class="primary-nav" aria-label="Main navigation">
            <button class="nav-link ${this.view === 'store' ? 'active' : ''}" data-view="store">${icon('grid')}<span>Discover</span></button>
            <button class="nav-link ${this.view === 'orders' ? 'active' : ''}" data-view="orders">${icon('cart')}<span>My orders</span><span class="nav-count">${this.reservations.length || ''}</span></button>
            <button class="nav-link ${this.view === 'support' ? 'active' : ''}" data-view="support">${icon('help')}<span>Help & support</span>${staff && openComplaints ? `<span class="nav-alert">${openComplaints}</span>` : ''}</button>
            ${!staff ? `<button class="nav-link ${this.view === 'suggestions' ? 'active' : ''}" data-view="suggestions">${icon('spark')}<span>Suggestions</span></button>` : ''}
            ${staff ? `<div class="nav-separator"></div><div class="workspace-label ops-label">OPERATIONS</div><button class="nav-link ${this.view === 'operations' ? 'active' : ''}" data-view="operations">${icon('chart')}<span>Overview</span></button><button class="nav-link ${this.view === 'vendor-inventory' ? 'active' : ''}" data-view="vendor-inventory">${icon('box')}<span>Inventory</span>${this.overview?.inventory.lowStock ? `<span class="nav-alert">${this.overview.inventory.lowStock}</span>` : ''}</button><button class="nav-link ${this.view === 'vendor-alerts' ? 'active' : ''}" data-view="vendor-alerts">${icon('bell')}<span>Alerts</span>${this.overview?.alerts.length ? `<span class="nav-alert">${this.overview.alerts.length}</span>` : ''}</button>` : ''}
          </nav>
          <div class="sidebar-bottom"><div class="help-card"><div class="help-symbol">${icon('spark', 18)}</div><div><strong>Good choices, made easy.</strong><span>Find a little something for your next break.</span></div><a href="#store" aria-label="Explore items">${icon('arrow', 15)}</a></div><button class="sidebar-user" data-action="account">${this.user ? `<span class="avatar">${initials(this.user.name)}</span><span class="account-copy"><strong>${escapeHtml(this.user.name)}</strong><small>${escapeHtml(this.user.role.toLowerCase())} account</small></span><span class="user-action">${icon('logout', 17)}</span>` : `<span class="avatar guest-avatar">G</span><span class="account-copy"><strong>Guest session</strong><small>Sign in to place an order</small></span><span class="user-action">${icon('arrow', 16)}</span>`}</button></div>
        </aside>
        <main class="main-area"><header class="topbar"><div class="breadcrumb"><span>VendSmart</span><span class="crumb-divider">/</span><strong>${this.view === 'store' ? 'Discover' : this.view === 'orders' ? 'My orders' : this.view === 'accounts' ? 'Users' : this.view === 'payment' ? 'Payment' : this.view === 'support' ? 'Help & support' : this.view === 'suggestions' ? 'Suggestions' : this.view === 'admin-requests' ? 'Operator requests' : this.view === 'admin-users' ? 'Users' : this.view === 'admin-operators' ? 'Operators' : this.view === 'admin-machines' ? 'Machines & assignment' : this.view === 'admin-support' ? 'Support / issues' : this.view === 'admin-audit' ? 'Audit log' : 'Overview'}</strong></div><div class="top-actions"><label class="currency-picker" title="Display currency"><select data-currency aria-label="Display currency">${CURRENCIES.map(row => `<option value="${row.code}" ${row.code === this.currency ? 'selected' : ''}>${row.code}</option>`).join('')}</select></label><span class="service-indicator"><i></i> All systems normal</span><button class="icon-button" data-action="orders" aria-label="View orders">${icon('bell')}<span class="notification-dot"></span></button><button class="top-avatar" data-action="account">${this.user ? initials(this.user.name) : 'G'}</button></div></header><div class="page-content">${content}</div><footer class="footer"><span>VendSmart <span class="footer-dot">·</span> Better breaks, one tap away.</span><span>Freshly stocked for your day <span class="footer-spark">✳</span></span></footer></main>
      </div>
      <div id="modal-root"></div><div id="toast-root" aria-live="polite"></div>`
    if (operatorPage) {
      const vendorLabels: Record<VendorView, string> = {
        'vendor-machines': 'My machines',
        'vendor-products': 'Products',
        'vendor-inventory': 'Inventory',
        'vendor-sales': 'Sales & analytics',
        'vendor-orders': 'Orders',
        'vendor-suggestions': 'Product suggestions',
        'vendor-alerts': 'Alerts',
        'vendor-support': 'Support requests',
      }
      const breadcrumb = app.querySelector<HTMLElement>('.breadcrumb strong')
      if (breadcrumb) breadcrumb.textContent = vendorLabels[this.view as VendorView]
    }
    if (this.view === 'store') {
      app.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(button => {
        const product = this.products.find(item => item._id === button.dataset.add)
        const info = button.closest('.product-info')
        if (!product || !info) return
        const price = info.querySelector<HTMLElement>('.product-price')
        if (price) price.innerHTML = this.priceMarkup(product)
        info.querySelector('.product-stock')?.insertAdjacentHTML('beforeend', this.expirationLabel(product))
      })
      app.querySelectorAll<HTMLElement>('[data-recommend]').forEach(button => {
        const product = this.products.find(item => item._id === button.dataset.recommend)
        const details = button.querySelector('small')
        const score = this.recommendations.find(item => item.product._id === product?._id)?.score || 0
        if (product && details) details.innerHTML = `${this.priceMarkup(product)} · ${this.expirationLabel(product)} · ${Math.round(score * 10) / 10} match`
      })
    }
    this.enhanceInventoryDashboard(app)
    if (this.user?.role === 'ADMIN') {
      const nav = app.querySelector<HTMLElement>('.primary-nav')
      if (nav) nav.innerHTML = `<button class="nav-link ${this.view === 'operations' ? 'active' : ''}" data-view="operations">${icon('chart')}<span>Dashboard</span></button><button class="nav-link ${this.view === 'admin-requests' ? 'active' : ''}" data-view="admin-requests">${icon('settings')}<span>Operator requests</span>${this.adminUsers.filter(account => account.operatorRequestStatus === 'PENDING' && !account.banned).length ? `<span class="nav-alert">${this.adminUsers.filter(account => account.operatorRequestStatus === 'PENDING' && !account.banned).length}</span>` : ''}</button><button class="nav-link ${this.view === 'admin-users' || this.view === 'accounts' ? 'active' : ''}" data-view="admin-users">${icon('grid')}<span>Users</span></button><button class="nav-link ${this.view === 'admin-operators' ? 'active' : ''}" data-view="admin-operators">${icon('settings')}<span>Operators</span></button><button class="nav-link ${this.view === 'admin-machines' ? 'active' : ''}" data-view="admin-machines">${icon('pin')}<span>Machines</span></button><button class="nav-link ${this.view === 'admin-assignment' ? 'active' : ''}" data-view="admin-assignment">${icon('repeat')}<span>Machine assignment</span></button><button class="nav-link ${this.view === 'admin-support' ? 'active' : ''}" data-view="admin-support">${icon('help')}<span>Support / issues</span></button><button class="nav-link ${this.view === 'admin-audit' ? 'active' : ''}" data-view="admin-audit">${icon('clock')}<span>Audit log</span></button>`
    }
    if (this.user?.role === 'OPERATOR') {
      const nav = app.querySelector<HTMLElement>('.primary-nav')
      if (nav) nav.innerHTML = `<button class="nav-link ${this.view === 'operations' ? 'active' : ''}" data-view="operations">${icon('chart')}<span>Dashboard</span></button><button class="nav-link ${this.view === 'vendor-machines' ? 'active' : ''}" data-view="vendor-machines">${icon('pin')}<span>My machines</span></button><button class="nav-link ${this.view === 'vendor-products' ? 'active' : ''}" data-view="vendor-products">${icon('box')}<span>Products</span></button><button class="nav-link ${this.view === 'vendor-inventory' ? 'active' : ''}" data-view="vendor-inventory">${icon('box')}<span>Inventory</span>${this.overview?.inventory.lowStock ? `<span class="nav-alert">${this.overview.inventory.lowStock}</span>` : ''}</button><button class="nav-link ${this.view === 'vendor-suggestions' ? 'active' : ''}" data-view="vendor-suggestions">${icon('spark')}<span>Product suggestions</span></button><button class="nav-link ${this.view === 'vendor-sales' ? 'active' : ''}" data-view="vendor-sales">${icon('chart')}<span>Sales & analytics</span></button><button class="nav-link ${this.view === 'vendor-orders' ? 'active' : ''}" data-view="vendor-orders">${icon('cart')}<span>Orders</span></button><button class="nav-link ${this.view === 'vendor-alerts' ? 'active' : ''}" data-view="vendor-alerts">${icon('bell')}<span>Alerts</span>${this.overview?.alerts.length ? `<span class="nav-alert">${this.overview.alerts.length}</span>` : ''}</button><button class="nav-link ${this.view === 'vendor-support' ? 'active' : ''}" data-view="vendor-support">${icon('help')}<span>Support requests</span></button>`
    }
    if (staff) {
      const shell = app.querySelector<HTMLElement>('.app-shell')
      if (shell) {
        const nav = shell.querySelector<HTMLElement>('.primary-nav')
        if (nav) nav.id = 'staff-mobile-nav'
        shell.insertAdjacentHTML('afterbegin', `<button class="staff-menu-toggle" type="button" aria-controls="staff-mobile-nav" aria-expanded="false" aria-label="Open navigation menu">${icon('menu', 20)}</button><button class="staff-nav-backdrop" type="button" aria-label="Close navigation menu" aria-hidden="true" tabindex="-1"></button>`)
      }
    }
    if (staff && (this.view === 'operations' || (this.user?.role === 'OPERATOR' && VENDOR_VIEWS.includes(this.view as VendorView)))) {
      app.querySelectorAll<HTMLElement>('.machine-status-row').forEach(row => {
        const action = row.querySelector<HTMLElement>('[data-edit-machine], [data-machine-status]')
        const machineId = action?.dataset.editMachine || action?.dataset.machineStatus
        if (machineId) action?.insertAdjacentHTML('beforebegin', `<button class="status-toggle" data-machine-details="${escapeHtml(machineId)}">Details & stock</button>`)
      })
    }
    this.bindEvents()
    if (this.view === 'store') this.mountMachineMap()
    if (this.view === 'orders') this.mountRouteMap()
  }

  /** Nearest stocked online machine, falling back to the one with the most units. */
  private recommendedMachine() {
    const stocked = this.machines.filter(machine => machine.status === 'ONLINE' && (machine.availableUnits || 0) > 0 && machine.topProduct)
    if (!stocked.length) return null
    if (this.userLocation) {
      const located = stocked.flatMap(machine => {
        const point = machineLatLng(machine)
        return point ? [{ machine, meters: distanceMeters([this.userLocation!.lat, this.userLocation!.lng], point) }] : []
      })
      if (located.length) return located.sort((a, b) => a.meters - b.meters)[0]
    }
    return { machine: [...stocked].sort((a, b) => (b.availableUnits || 0) - (a.availableUnits || 0))[0], meters: null }
  }

  private renderRecommendedMachine() {
    const pick = this.recommendedMachine()
    if (!pick) return ''
    const { machine, meters } = pick
    const top = machine.topProduct!
    const distance = meters === null ? '' : ` (${formatDistance(meters)})`
    return `<section class="recommend-panel"><div class="recommend-head"><span class="recommend-pin">${icon('pin', 17)}</span><strong>${escapeHtml(machine.name)}${distance}</strong><span class="live-badge"><i></i>LIVE</span></div><article class="recommend-card"><div class="recommend-card-top"><h3>${escapeHtml(top.name)}</h3><strong class="recommend-price">${this.priceMarkup(top)}</strong></div><div class="recommend-stock"><span class="availability-pill ${top.available <= 4 ? 'low' : ''}">${icon('check', 12)} ${top.available <= 4 ? 'Low stock' : 'Available'}</span><span>${top.available} units in stock</span></div>${this.expirationLabel(top)}<button class="recommend-cta" data-recommend-machine="${machine._id}">${machine._id === this.selectedMachine ? 'Current Machine' : 'Recommended Machine'}</button></article><div class="connected-strip">${icon('wifi', 15)} Connected to Machine #${escapeHtml(machine.code)}</div></section>`
  }

  private priceMarkup(product: Pick<Product, 'price' | 'originalPrice' | 'discountPercent'>) {
    return product.discountPercent && product.originalPrice !== undefined
      ? `<span class="discount-price">${this.money(product.price)}</span><del>${this.money(product.originalPrice)}</del><small class="discount-tag">−${product.discountPercent}%</small>`
      : this.money(product.price)
  }

  private expirationLabel(product: Pick<Product, 'expirationDate' | 'expired'>) {
    if (!product.expirationDate) return '<small class="expiry-note">Expiry date not set</small>'
    const date = new Date(`${product.expirationDate.slice(0, 10)}T00:00:00Z`)
    const today = new Date()
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    const days = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - todayUtc) / 86400000)
    const expired = product.expired ?? days < 0
    const label = expired ? 'Expired' : days === 0 ? 'Expires today' : days <= 7 ? `Expires in ${days} day${days === 1 ? '' : 's'}` : `Expires ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    return `<small class="expiry-note ${expired ? 'expired' : days <= 7 ? 'soon' : ''}">${escapeHtml(label)}</small>`
  }

  private discountIsActive(expirationDate?: string | null, discountPercent?: number) {
    if (!expirationDate || !discountPercent) return false
    const expiresAt = new Date(expirationDate).getTime()
    const expiresDay = new Date(`${expirationDate.slice(0, 10)}T00:00:00Z`)
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const days = Math.floor((Date.UTC(expiresDay.getUTCFullYear(), expiresDay.getUTCMonth(), expiresDay.getUTCDate()) - today) / 86400000)
    return expiresAt >= Date.now() && days >= 0 && days <= 7
  }

  private estimatedInventoryExpirations() {
    const dates = new Map<string, string>()
    const rowsByMachine = new Map<string, InventoryRow[]>()
    for (const row of this.inventory) {
      const machineId = row.machine._id
      const rows = rowsByMachine.get(machineId) || []
      rows.push(row)
      rowsByMachine.set(machineId, rows)
    }

    for (const rows of rowsByMachine.values()) {
      const usedDays = new Set<number>()
      const sortedRows = [...rows].sort((a, b) => {
        const productOrder = `${a.product.sku} ${a.product.name}`.localeCompare(`${b.product.sku} ${b.product.name}`)
        return productOrder || a._id.localeCompare(b._id)
      })
      for (const row of sortedRows) {
        if (row.expirationDate) continue
        const productDescription = `${row.product.category} ${row.product.name}`.toLowerCase()
        const shelfLife = /fresh|dairy|yogurt|milk|sandwich|salad/.test(productDescription)
          ? { min: 7, spread: 24 }
          : /drink|beverage|water|juice|coffee|tea|soda/.test(productDescription)
            ? { min: 45, spread: 91 }
            : /chip|snack|biscuit|cookie|chocolate|candy|gum/.test(productDescription)
              ? { min: 90, spread: 151 }
              : { min: 30, spread: 121 }
        let hash = 0
        for (const character of `${row.machine.code}:${row.product.sku}:${row._id}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
        let days = shelfLife.min + hash % shelfLife.spread
        while (usedDays.has(days)) days += 1
        usedDays.add(days)
        const today = new Date()
        const expiry = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))
        dates.set(row._id, expiry.toISOString().slice(0, 10))
      }
    }
    return dates
  }

  private inventoryExpiryLabel(row: InventoryRow, estimates: Map<string, string>) {
    if (row.expirationDate) {
      return this.expirationLabel({
        expirationDate: row.expirationDate.slice(0, 10),
        expired: new Date(row.expirationDate).getTime() < Date.now(),
      })
    }
    const date = estimates.get(row._id)
    return date
      ? `<small class="expiry-note estimated">Demo estimate · ${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</small>`
      : this.expirationLabel({ expirationDate: null })
  }

  private enhanceInventoryDashboard(root: ParentNode) {
    const estimates = this.estimatedInventoryExpirations()
    root.querySelectorAll<HTMLTableElement>('#inventory .dashboard-inventory-table').forEach(table => {
      const header = table.querySelector('thead tr')
      if (!header) return
      const expiryHeader = document.createElement('th')
      expiryHeader.textContent = 'Expiry / offer'
      header.insertBefore(expiryHeader, header.children[4] || null)
      const emptyCell = table.querySelector<HTMLTableCellElement>('.dashboard-empty')
      if (emptyCell) emptyCell.colSpan = 6
      table.querySelectorAll<HTMLButtonElement>('[data-edit-inventory]').forEach(button => {
        const inventory = this.inventory.find(row => row._id === button.dataset.editInventory)
        const tableRow = button.closest('tr')
        if (!inventory || !tableRow) return
        const cell = document.createElement('td')
        const activeDiscount = this.discountIsActive(inventory.expirationDate, inventory.discountPercent)
        cell.innerHTML = `${this.inventoryExpiryLabel(inventory, estimates)}${inventory.discountPercent ? `<small class="discount-tag">${inventory.discountPercent}% ${activeDiscount ? 'offer active' : 'discount set'}</small>` : ''}`
        tableRow.insertBefore(cell, tableRow.children[4] || null)
      })
    })
  }

  private renderOperatorAccessCard() {
    if (this.user?.role !== 'CUSTOMER') return ''
    const status = this.user.operatorRequestStatus || 'NONE'
    if (status === 'PENDING') return `<section class="operator-access-card"><div><strong>Operator access requested</strong><p>Your request is waiting for administrator review.</p></div><span class="operator-access-status">${icon('clock', 15)} Pending</span></section>`
    if (status === 'APPROVED') return `<section class="operator-access-card"><div><strong>Your operator request was approved</strong><p>Sign out and back in to open your operator dashboard.</p></div></section>`
    const rejected = status === 'REJECTED'
    return `<section class="operator-access-card"><div><strong>${rejected ? 'Reapply to become an operator' : 'Want to become a VendSmart operator?'}</strong><p>${rejected ? 'Your previous request was declined. You can submit a new request for review.' : 'Request access from an administrator. Once approved, you can add and manage your own vending machines.'}</p></div><button class="button-secondary" data-action="request-operator">${icon('settings', 16)} ${rejected ? 'Request again' : 'Request operator access'}</button></section>`
  }

  private renderSuggestionBoard(staff = false) {
    const customer = this.user?.role === 'CUSTOMER'
    const openSuggestions = this.suggestions.filter(suggestion => suggestion.status === 'OPEN')
    const suggestions = staff ? openSuggestions : this.suggestions
    return `<section class="suggestion-board ${staff ? 'suggestion-board-staff' : ''}" id="${staff ? 'admin-suggestions' : 'product-suggestions'}"><div class="suggestion-board-heading"><div><span class="section-kicker">${staff ? 'CUSTOMER DEMAND' : 'YOUR IDEAS, SHARED'}</span><h2>${staff ? 'What customers <em>want next.</em>' : 'What should we <em>stock next?</em>'}</h2><p>${staff ? 'Popular requests from customers. Add a requested item to the catalog or decline it.' : 'Suggest an item or vote for something you would like to see in the machines.'}</p></div>${staff ? `<span class="suggestion-total">${openSuggestions.length} open</span>` : ''}</div>${customer ? `<form class="suggestion-form" id="suggestion-form"><label class="suggestion-item-select">Choose an item to suggest<select name="name" required><option value="" disabled selected>Select a snack or drink</option>${SUGGESTION_OPTIONS.map(group => `<optgroup label="${escapeHtml(group.category)}">${group.items.map(item => `<option value="${escapeHtml(item)}" data-category="${escapeHtml(group.category)}">${escapeHtml(item)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="suggestion-details">Anything else? <span>(optional)</span><input name="details" maxlength="500" placeholder="Share a size or other detail"></label><button class="button-primary" type="submit">Share suggestion ${icon('arrow', 14)}</button></form>` : !staff && !this.user ? `<div class="suggestion-signin"><span>Sign in to share an idea or vote.</span><button class="button-secondary" data-action="account">Sign in</button></div>` : ''}<div class="suggestion-list">${suggestions.length ? suggestions.map(suggestion => `<article class="suggestion-card"><div class="suggestion-vote-count"><strong>${suggestion.votes}</strong><small>vote${suggestion.votes === 1 ? '' : 's'}</small></div><div class="suggestion-copy"><strong>${escapeHtml(suggestion.name)}</strong><small>${escapeHtml(suggestion.category || 'General')} ${suggestion.details ? `· ${escapeHtml(suggestion.details)}` : ''}</small>${suggestion.status === 'ADDED' ? `<span class="suggestion-added">${icon('check', 12)} Added to catalog${suggestion.product ? ` · ${escapeHtml(suggestion.product.name)}` : ''}</span>` : ''}</div>${staff ? `<div class="suggestion-actions"><button class="button-secondary" data-add-suggestion="${suggestion._id}">Add product</button><button class="text-button danger" data-decline-suggestion="${suggestion._id}">Decline</button></div>` : customer && suggestion.status === 'OPEN' ? `<button class="suggestion-vote ${suggestion.voted ? 'voted' : ''}" data-vote-suggestion="${suggestion._id}" aria-pressed="${suggestion.voted}">${suggestion.voted ? 'Voted' : 'Vote'}</button>` : ''}</article>`).join('') : `<div class="suggestion-empty">${staff ? 'No open customer suggestions right now.' : 'No suggestions yet. Be the first to share an idea.'}</div>`}</div></section>`
  }

  private stockBadge(product: Product) {
    const available = product.available
    if (available === undefined) return ''
    if (available === 0) return '<span class="availability-pill out">Sold out</span><span class="stock-units">Restocking soon</span>'
    if (available <= 4) return `<span class="availability-pill low">${icon('check', 12)} Low stock</span><span class="stock-units">${available} unit${available === 1 ? '' : 's'} left</span>`
    return `<span class="availability-pill">${icon('check', 12)} Available</span><span class="stock-units">${available} units in stock</span>`
  }

  private addButton(product: Product) {
    if (product.available === 0) return '<button class="product-cta sold" disabled>Sold out</button>'
    const count = this.cart.get(product._id) || 0
    return `<button class="product-cta" data-add="${product._id}">${icon('plus', 14)} ${count ? `Add another · ${count} in bag` : 'Add to bag'}</button>`
  }

  /** Map and machine-list clicks open the shelf of that specific machine. */
  private async openMachineContents(machineId: string) {
    const machine = this.machines.find(row => row._id === machineId)
    if (!machine) return
    this.contentsMachine = machine
    this.contentsItems = null
    this.renderMachineContents()
    try {
      const items = await this.request<Product[]>(`/products?machineId=${machineId}`)
      if (this.contentsMachine?._id !== machineId) return
      this.contentsItems = items.slice().sort((a, b) => (b.available || 0) - (a.available || 0) || a.name.localeCompare(b.name))
      this.renderMachineContents()
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async openMachineDetails(machineId: string) {
    if (!this.user || !['ADMIN', 'OPERATOR'].includes(this.user.role)) return
    try {
      const [machine, inventory] = await Promise.all([
        this.request<Machine>(`/machines/${machineId}`),
        this.request<InventoryRow[]>(`/inventory?machineId=${encodeURIComponent(machineId)}`),
      ])
      const root = document.querySelector<HTMLDivElement>('#modal-root')
      if (!root) return
      const coordinates = machine.location?.coordinates
      const vendor = typeof machine.vendor === 'object' && machine.vendor ? machine.vendor.name : 'Unassigned'
      const vendorId = typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id || ''
      const lastSeen = machine.lastHeartbeat ? new Date(machine.lastHeartbeat).toLocaleString() : 'Not reported'
      const operatorAssignment = this.user.role === 'ADMIN'
        ? `<form class="form-stack" data-machine-assignment><label>Assigned operator<select name="vendorId"><option value="">Unassigned</option>${this.adminUsers.filter(account => account.role === 'OPERATOR' && !account.banned).map(account => `<option value="${account._id}" ${account._id === vendorId ? 'selected' : ''}>${escapeHtml(account.name)} · ${escapeHtml(account.email)}</option>`).join('')}</select></label><button class="button-secondary" type="submit">Save operator assignment</button></form>`
        : ''
      root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card contents-modal" role="dialog" aria-modal="true" aria-labelledby="machine-details-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow"><span class="eyebrow-line"></span> MACHINE DETAILS</div><div class="contents-head"><strong id="machine-details-title">${escapeHtml(machine.name)}</strong><span class="status-pill status-${machine.status.toLowerCase()}"><i></i>${escapeHtml(machine.status.toLowerCase())}</span></div><p class="contents-address">${escapeHtml(machine.address)}</p><div class="contents-summary"><span>${icon('box', 15)} ${inventory.length} stocked products · ${inventory.reduce((total, row) => total + (row.available ?? Math.max(0, row.quantity - row.reserved)), 0)} available units</span><span>MACHINE #${escapeHtml(machine.code)}</span></div><div class="machine-detail-grid"><div><small>Operator</small><strong>${escapeHtml(vendor)}</strong></div><div><small>Capacity</small><strong>${machine.capacity ?? '—'}</strong></div><div><small>Last heartbeat</small><strong>${escapeHtml(lastSeen)}</strong></div><div><small>Coordinates</small><strong>${coordinates ? `${coordinates[1]}, ${coordinates[0]}` : 'Not set'}</strong></div>${machine.description ? `<div class="machine-detail-description"><small>Description</small><strong>${escapeHtml(machine.description)}</strong></div>` : ''}</div>${operatorAssignment}<div class="contents-list">${inventory.length ? inventory.map(row => `<div class="contents-row"><span class="contents-art">${imageFor(row.product)}</span><span class="contents-copy"><strong>${escapeHtml(row.product.name)}</strong><small>${escapeHtml(row.product.sku)}${row.slot ? ` · Slot ${escapeHtml(row.slot)}` : ''} · ${this.money(row.product.price)}</small></span><span class="contents-stock"><strong>${row.available ?? Math.max(0, row.quantity - row.reserved)} / ${row.quantity}</strong><small>${row.reserved} reserved · threshold ${row.lowStockThreshold}</small></span><button class="text-button" data-detail-adjust="${row._id}">Adjust</button></div>`).join('') : '<div class="contents-loading">No inventory has been assigned to this machine yet.</div>'}</div><button class="button-secondary manage-stock-button" data-add-machine-stock="${machine._id}">${icon('plus', 14)} Add stock to this machine</button></section></div>`
      root.querySelectorAll<HTMLElement>('.contents-row').forEach((node, index) => {
        const row = inventory[index]
        if (!row) return
        const price = node.querySelector<HTMLElement>('.contents-copy small')
        const activeDiscount = this.discountIsActive(row.expirationDate, row.discountPercent)
        const unitPrice = activeDiscount ? Math.round(row.product.price * (1 - (row.discountPercent || 0) / 100) * 100) / 100 : row.product.price
        if (price) price.innerHTML = `${escapeHtml(row.product.sku)}${row.slot ? ` · Slot ${escapeHtml(row.slot)}` : ''} · ${this.priceMarkup({ price: unitPrice, originalPrice: activeDiscount ? row.product.price : undefined, discountPercent: activeDiscount ? row.discountPercent : undefined })} · ${this.expirationLabel({ expirationDate: row.expirationDate ? row.expirationDate.slice(0, 10) : null, expired: row.expirationDate ? new Date(row.expirationDate).getTime() < Date.now() : false })}`
      })
      root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
      root.querySelector<HTMLFormElement>('[data-machine-assignment]')?.addEventListener('submit', async event => {
        event.preventDefault()
        const form = event.currentTarget as HTMLFormElement
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
        const vendorId = new FormData(form).get('vendorId')
        if (!(typeof vendorId === 'string' || vendorId === null)) return
        if (button) button.disabled = true
        try {
          await this.request<Machine>(`/machines/${machine._id}`, { method: 'PATCH', body: JSON.stringify({ vendorId: vendorId || null }) })
          root.innerHTML = ''
          await this.load()
          this.toast('Machine operator assignment saved.', 'success')
        } catch (error) {
          if (button) button.disabled = false
          this.toast(`Could not assign this machine: ${(error as Error).message}`, 'error')
        }
      })
      root.querySelectorAll<HTMLElement>('[data-detail-adjust]').forEach(node => node.addEventListener('click', () => { const id = node.dataset.detailAdjust; root.innerHTML = ''; if (id) this.openInventoryEditor(id) }))
      root.querySelector<HTMLElement>('[data-add-machine-stock]')?.addEventListener('click', event => {
        const id = (event.currentTarget as HTMLElement).dataset.addMachineStock
        root.innerHTML = ''
        if (id) this.openInventoryEditor(undefined, id)
      })
    } catch (error) {
      this.toast(`Could not load machine details: ${(error as Error).message}`, 'error')
    }
  }

  private closeMachineContents() {
    this.contentsMachine = null
    this.contentsItems = null
    const root = document.querySelector<HTMLDivElement>('#modal-root')
    if (root) root.innerHTML = ''
  }

  private renderMachineContents() {
    const root = document.querySelector<HTMLDivElement>('#modal-root')
    const machine = this.contentsMachine
    if (!root || !machine) return
    const items = this.contentsItems
    const total = (items || []).reduce((sum, item) => sum + (item.available || 0), 0)
    const inStock = (items || []).filter(item => (item.available || 0) > 0).length
    const point = machineLatLng(machine)
    const meters = point && this.userLocation ? distanceMeters([this.userLocation.lat, this.userLocation.lng], point) : null
    const distance = meters === null ? '' : ` (${formatDistance(meters)})`
    const live = machine.status === 'ONLINE'
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card contents-modal" role="dialog" aria-modal="true" aria-labelledby="contents-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="contents-head"><span class="recommend-pin">${icon('pin', 17)}</span><strong id="contents-title">${escapeHtml(machine.name)}${distance}</strong><span class="live-badge ${live ? '' : 'off'}"><i></i>${live ? 'LIVE' : escapeHtml(machine.status)}</span></div><p class="contents-address">${escapeHtml(machine.address)}</p><div class="contents-summary"><span>${icon('box', 15)} ${items ? `${total} units across ${inStock} items` : 'Checking stock…'}</span><span>MACHINE #${escapeHtml(machine.code)}</span></div><div class="contents-list">${items ? items.map(item => `<div class="contents-row ${item.available === 0 ? 'empty' : ''}"><span class="contents-art">${imageFor(item)}</span><span class="contents-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${this.money(item.price)}</small></span><span class="contents-stock">${this.stockBadge(item)}</span></div>`).join('') : '<div class="contents-loading">Loading the shelf on this machine…</div>'}</div><button class="recommend-cta contents-choose" data-use-machine="${machine._id}" ${live ? '' : 'disabled'}>${machine._id === this.selectedMachine ? 'This is your pickup machine' : 'Pick up from this machine'}</button></section></div>`
    if (items) root.querySelectorAll<HTMLElement>('.contents-row').forEach((node, index) => {
      const product = items[index]
      if (!product) return
      const details = node.querySelector<HTMLElement>('.contents-copy small')
      if (details) details.innerHTML = `${escapeHtml(product.category)} · ${this.priceMarkup(product)}`
      node.querySelector('.contents-stock')?.insertAdjacentHTML('beforeend', this.expirationLabel(product))
    })
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) this.closeMachineContents() }))
    root.querySelector<HTMLElement>('[data-use-machine]')?.addEventListener('click', () => { const id = machine._id; this.closeMachineContents(); void this.selectMachine(id) })
  }

  private renderStore() {
    const machine = this.machines.find(row => row._id === this.selectedMachine)
    const categories = [...(this.user ? ['Favorites'] : []), 'All items', ...new Set(this.products.map(product => product.category))]
    const visible = this.products.filter(product => this.category === 'All items' || (this.category === 'Favorites' ? this.favorites.has(product._id) : product.category === this.category))
    const cartQuantity = [...this.cart.values()].reduce((sum, n) => sum + n, 0)
    const subtotal = this.products.reduce((sum, product) => sum + product.price * (this.cart.get(product._id) || 0), 0)
    return `<section class="hero-panel"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span> YOUR BREAK, UPGRADED</div><h1>A little good<br>goes a <em>long way.</em></h1><p>Thoughtful snacks, better-for-you sips, and everyday essentials — exactly where you need them.</p><div class="hero-points"><span><i class="point-check">${icon('check', 12)}</i> Freshly stocked</span><span><i class="point-check">${icon('check', 12)}</i> Ready when you are</span></div></div><div class="hero-art" aria-hidden="true"><div class="art-sun"></div><div class="art-line line-one"></div><div class="art-line line-two"></div><div class="art-product art-drink"><span>✳</span></div><div class="art-product art-snack"><span>GOOD<br>ENERGY</span></div><div class="art-product art-bar"><span>take<br>a break</span></div><div class="art-note">A brighter<br>kind of break <i>✳</i></div><div class="floating-tag">made for your<br>in-between</div></div><div class="hero-counter"><span class="counter-dot"></span> THE GOOD STUFF, CLOSE BY <strong>${this.products.length ? `${String(this.products.length).padStart(2, '0')}+` : '—'}</strong></div></section>
    <section class="machine-row"><div><span class="section-kicker">PICKUP LOCATION</span><strong>${machine ? `${icon('pin', 17)} ${escapeHtml(machine.name)}` : `${icon('pin', 17)} Choose a nearby machine`}</strong><small>${escapeHtml(machine?.address || 'Select an available location to see its menu.')}</small></div><label class="machine-select-wrap"><span>CHANGE MACHINE</span><select id="machine-select">${this.machines.map(row => `<option value="${row._id}" ${row._id === this.selectedMachine ? 'selected' : ''} ${row.status !== 'ONLINE' ? 'disabled' : ''}>${escapeHtml(row.name)} · ${row.status === 'ONLINE' ? 'Ready' : row.status.toLowerCase()}</option>`).join('')}</select><i>${icon('pin', 16)}</i></label></section>
    ${this.renderOperatorAccessCard()}
    ${this.renderRecommendedMachine()}
    <section class="machine-map-section"><div class="machine-map-heading"><div><span class="section-kicker">MACHINE FINDER</span><h2>Find a good thing <em>nearby.</em></h2></div><button class="button-secondary" data-action="locate-machines">${icon('pin', 15)} Find near me</button></div><div class="machine-map-layout"><div id="machine-map" class="machine-map" role="application" aria-label="Map of VendSmart pickup machines"></div><div class="machine-location-list">${this.machines.map(row => { const point = machineLatLng(row); const meters = point && this.userLocation ? distanceMeters([this.userLocation.lat, this.userLocation.lng], point) : null; const distance = meters === null ? '' : `${formatDistance(meters)} · ~${Math.max(1, Math.round(meters / 75))} min`; return `<button class="machine-location ${row._id === this.selectedMachine ? 'selected' : ''}" data-choose-machine="${row._id}"><span class="machine-location-pin">${icon('pin', 16)}</span><span class="machine-location-copy"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.address)}</small></span>${distance ? `<span class="machine-distance">${distance}</span>` : `<span class="machine-location-status status-${row.status.toLowerCase()}">${escapeHtml(row.status.toLowerCase())}</span>`}</button>` }).join('') || '<div class="map-empty">Machine locations will appear here.</div>'}<p id="machine-location-status" class="map-status">${escapeHtml(this.locationStatus)}</p></div></div><small class="map-attribution-note">Map data © OpenStreetMap contributors · Nearby sorting uses your device only. Starting a live route shares your GPS coordinates with the OpenStreetMap routing service; no VendSmart account data is sent.</small></section>
    <section class="catalog-section"><div class="catalog-heading"><div><div class="eyebrow catalog-eyebrow"><span class="eyebrow-line"></span> PICK SOMETHING GOOD</div><h2>Made for your <em>moment.</em></h2></div><div class="catalog-actions"><label class="search-box">${icon('search', 17)}<input id="product-search" value="${escapeHtml(this.search)}" placeholder="Find your favorite..."><kbd>⌘ K</kbd></label><button class="cart-button" data-action="cart">${icon('cart', 17)}<span>Your bag</span><b>${cartQuantity}</b></button></div></div><form class="smart-filter" id="smart-filter-form"><span class="smart-filter-icon">${icon('spark', 16)}</span><label for="smart-filter-input"><strong>Tell us what sounds good</strong><small>e.g. a vegan snack under ${this.money(4)}</small></label><input id="smart-filter-input" value="${escapeHtml(this.prompt)}" placeholder="I'm in the mood for something..." maxlength="180"><button class="smart-filter-button" type="submit">Find my fit ${icon('arrow', 14)}</button>${this.prompt ? `<button class="smart-filter-clear" type="button" data-action="clear-prompt" aria-label="Clear suggestions">${icon('close', 15)}</button>` : ''}</form>${this.prompt && this.recommendations.length ? `<div class="recommendation-strip"><span>${icon('spark', 15)} PICKED FOR YOU</span>${this.recommendations.map(row => `<button class="recommendation-chip" data-recommend="${row.product._id}">${imageFor(row.product)}<span>${escapeHtml(row.product.name)}<small>${this.money(row.product.price)} · ${Math.round(row.score * 10) / 10} match</small></span></button>`).join('')}</div>` : ''}<div class="category-tabs">${categories.map(category => `<button class="category-tab ${category === this.category ? 'selected' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}<span>${category === 'All items' ? this.products.length : category === 'Favorites' ? this.favorites.size : this.products.filter(product => product.category === category).length}</span></button>`).join('')}</div>
    ${visible.length ? `<div class="product-grid">${visible.map((product, index) => `<article class="product-card" style="--card-index:${index}"><div class="product-visual visual-${index % 6}"><div class="product-badge">${product.category === 'Better for you' ? 'GOOD FOR YOU' : product.category === 'Essentials' ? 'LITTLE ESSENTIAL' : product.tags?.[0]?.toUpperCase() || 'A GOOD PICK'}</div><div class="product-image">${imageFor(product)}</div><button class="favorite-toggle ${this.favorites.has(product._id) ? 'on' : ''}" data-favorite="${product._id}" aria-label="${this.favorites.has(product._id) ? `Remove ${escapeHtml(product.name)} from favorites` : `Save ${escapeHtml(product.name)} to favorites`}">${icon('heart', 15)}</button></div><div class="product-info"><div class="product-card-top"><h3>${escapeHtml(product.name)}</h3><strong class="product-price">${this.money(product.price)}</strong></div><div class="product-stock">${this.stockBadge(product)}</div><p>${escapeHtml(product.description)}</p><div class="product-tags">${(product.tags || []).slice(0, 2).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}<span class="sku">${escapeHtml(product.sku)}</span></div>${this.addButton(product)}</div></article>`).join('')}</div>` : `<div class="empty-state catalog-empty"><div class="empty-icon">${this.category === 'Favorites' ? icon('heart', 24) : icon('search', 24)}</div><h3>${this.category === 'Favorites' ? 'Nothing saved at this machine yet' : 'No good finds yet'}</h3><p>${this.category === 'Favorites' ? 'Tap the heart on anything you love and it will wait here for your next stop.' : 'Try another search or choose a different pickup location.'}</p><button class="button-secondary" data-action="reset-search">Clear filters</button></div>`}
    </section><div class="store-bottom"><span>${icon('spark', 15)} Thoughtfully chosen. Conveniently close.</span><span>Prices in ${this.currency}${this.currencyRateNote() ? ` <b>·</b> ${this.currencyRateNote()}` : ''} <b>·</b> Pickup is free</span></div>${cartQuantity ? `<button class="mobile-cart" data-action="cart">${icon('cart', 18)} View your bag <b>${cartQuantity} items · ${this.money(subtotal)}</b></button>` : ''}`
  }

  private renderOrders() {
    return `${this.renderLiveRoutePanel()}<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> YOUR RECENT PICKUPS</div><h1>Every good thing,<br><em>in one place.</em></h1><p>Track an order, find your pickup code, or pick up right where you left off.</p></div><button class="button-primary" data-view="store">${icon('plus', 17)} Find something good</button></section>${!this.user ? `<div class="empty-state order-empty"><div class="empty-icon">${icon('cart', 23)}</div><h3>Your next good break starts here.</h3><p>Sign in to keep your orders and pickup codes in one place.</p><button class="button-primary" data-action="account">${icon('arrow', 16)} Sign in to continue</button></div>` : this.reservations.length ? `<div class="order-list">${this.reservations.map(order => `<article class="order-card"><div class="order-top"><div><span class="order-reference">ORDER ${escapeHtml(order.code)}</span><h3>${escapeHtml(order.machine?.name || 'VendSmart pickup')}</h3><span class="order-address">${escapeHtml(order.machine?.address || '')}</span></div><span class="status-pill status-${order.status.toLowerCase()}"><i></i>${escapeHtml(order.status.toLowerCase())}</span></div><div class="order-meta"><span>${icon('clock', 15)} ${new Date(order.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span>${order.items?.reduce((n, item) => n + item.quantity, 0) || '—'} items</span><strong>${this.money(order.total)}</strong></div>${order.status === 'PENDING' ? `<div class="payment-due"><span class="payment-due-icon">${icon('card', 16)}</span><div><strong>Payment not completed</strong><small>Your picks are held for 15 minutes — pay now to unlock your pickup code.</small></div><button class="button-primary pay-order-button" data-pay="${order._id}">Pay ${this.money(order.total)}</button></div>` : ''}${order.status === 'PAID' ? `<div class="pickup-code"><div><span>YOUR PICKUP CODE</span><strong>${order.pickupOtp ? order.pickupOtp.match(/.{1,3}/g)?.join(' ') : 'Code available in your latest order details'}</strong><small>Enter this 6-digit code at the machine within 15 minutes.</small></div><button data-dispense="${order._id}" data-otp="${escapeHtml(order.pickupOtp || '')}">${icon('check', 16)} Dispense</button></div>` : ''}<div class="order-items">${(order.items || []).map(item => `<span>${escapeHtml(item.name)} <b>× ${item.quantity}</b></span>`).join('')}</div>${['PAID', 'PENDING'].includes(order.status) ? `<button class="order-cancel" data-cancel="${order._id}">Cancel reservation</button>` : `<button class="order-reorder" data-reorder="${order._id}">${icon('repeat', 14)} Reorder these picks</button>`}<button class="order-report" data-report="${order._id}">${icon('help', 13)} Report a problem</button></article>`).join('')}</div>` : `<div class="empty-state order-empty"><div class="empty-icon">${icon('coffee', 23)}</div><h3>Nothing on the pickup shelf yet.</h3><p>Find your machine, fill your bag, and your first order will appear right here.</p><button class="button-primary" data-view="store">Explore the menu ${icon('arrow', 16)}</button></div>`}`
  }

  private renderAccountsPanel() {
    if (this.user?.role !== 'ADMIN') return `<div class="empty-state"><h3>Administrator access required</h3><p>Only administrators can manage customer and operator accounts.</p><button class="button-primary" data-action="account">Back to account</button></div>`
    const accounts = this.adminUsers.filter(account => account.role !== 'ADMIN')
    const customers = accounts.filter(account => account.role === 'CUSTOMER').length
    const operators = accounts.filter(account => account.role === 'OPERATOR').length
    const banned = accounts.filter(account => account.banned).length
    const accountContent = !this.adminUsersLoaded ? '<p class="inline-empty">Loading customer and operator accounts…</p>' : accounts.length ? accounts.map(account => `<div class="account-row ${account.banned ? 'is-banned' : ''}" data-account-row data-search="${escapeHtml(`${account.name} ${account.email} ${account.role}`.toLowerCase())}"><span class="avatar">${initials(account.name)}</span><div class="account-copy"><strong>${escapeHtml(account.name)} · ${account.role === 'OPERATOR' ? 'Operator' : 'Customer'}</strong><span>${escapeHtml(account.email)}</span><small>${account.banned ? `Suspended${account.bannedAt ? ` · ${new Date(account.bannedAt).toLocaleDateString()}` : ''}` : `Joined ${new Date(account.createdAt).toLocaleDateString()}`}</small></div><div class="account-actions">${account.role === 'OPERATOR' ? `<button class="text-button" data-set-role="${account._id}" data-role-target="CUSTOMER">Make customer</button>` : account.operatorRequestStatus === 'PENDING' ? '<span class="admin-badge issue-open">Request pending</span>' : ''}<button class="text-button ${account.banned ? '' : 'danger'}" data-set-ban="${account._id}" data-banned="${account.banned}">${account.banned ? 'Restore access' : 'Ban account'}</button></div></div>`).join('') : '<p class="inline-empty">No customer or operator accounts found.</p>'
    return `<section class="ops-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> ADMIN CONTROL CENTER</div><h1>People & <em>access.</em></h1><p>Manage customer and operator access across VendSmart.</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh accounts</button></section><section class="metrics-grid"><article class="metric-card"><div class="metric-header"><span>Customer accounts</span><i class="metric-icon mint">${icon('heart', 18)}</i></div><strong>${customers}</strong><span class="metric-caption">Registered customers</span></article><article class="metric-card"><div class="metric-header"><span>Operator accounts</span><i class="metric-icon peach">${icon('settings', 18)}</i></div><strong>${operators}</strong><span class="metric-caption">Machine operators</span></article><article class="metric-card ${banned ? 'metric-warn' : ''}"><div class="metric-header"><span>Suspended accounts</span><i class="metric-icon yellow">${icon('lock', 18)}</i></div><strong>${banned}</strong><span class="metric-caption">Customers and operators</span></article><article class="metric-card"><div class="metric-header"><span>Managed accounts</span><i class="metric-icon lavender">${icon('grid', 18)}</i></div><strong>${accounts.length}</strong><span class="metric-caption">Administrator accounts are protected</span></article></section><section class="panel account-management-panel"><div class="panel-heading"><div><span class="section-kicker">ACCOUNT ACCESS</span><h2>Customers & <em>operators.</em></h2></div><label class="search-box">${icon('search', 16)}<input id="account-search" value="${escapeHtml(this.adminSearch)}" placeholder="Search name or email" aria-label="Search accounts"></label></div><div class="account-list">${accountContent}<p class="inline-empty" id="account-search-empty" hidden>No accounts match your search.</p></div></section>`
  }

  private renderAdminDashboard() {
    const customers = this.adminUsers.filter(account => account.role === 'CUSTOMER')
    const operators = this.adminUsers.filter(account => account.role === 'OPERATOR')
    const operatorRequests = customers.filter(account => account.operatorRequestStatus === 'PENDING' && !account.banned)
    const activeOperators = operators.filter(account => !account.banned)
    const openComplaints = this.complaints.filter(complaint => complaint.status === 'OPEN')
    const assignedMachineCount = this.machines.filter(machine => machine.vendor).length
    const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const assignedMachinesFor = (operatorId: string) => this.machines.filter(machine => (typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id) === operatorId).map(machine => machine.code).join(', ') || 'No machines'
    const accountRows = (accounts: Account[], role: 'CUSTOMER' | 'OPERATOR') => !this.adminUsersLoaded
      ? '<tr><td colspan="6" class="admin-table-empty">Loading accounts…</td></tr>'
      : accounts.length
        ? accounts.map((account, index) => `<tr data-admin-searchable data-admin-role="${role}" data-admin-search="${escapeHtml(`${account.name} ${account.email} ${account.role} ${role === 'OPERATOR' ? assignedMachinesFor(account._id) : ''}`.toLowerCase())}"><td>${index + 1}</td><td><span class="admin-person"><i>${escapeHtml(initials(account.name))}</i><strong>${escapeHtml(account.name)}</strong></span></td><td>${escapeHtml(account.email)}</td>${role === 'OPERATOR' ? `<td>${escapeHtml(assignedMachinesFor(account._id))}</td>` : `<td>${formatDate(account.createdAt)}</td>`}<td><span class="admin-badge ${account.banned ? 'banned' : 'active'}">${account.banned ? 'Banned' : 'Active'}</span></td><td><div class="admin-account-actions">${role === 'OPERATOR' ? `<button class="admin-row-action view" data-set-role="${account._id}" data-role-target="CUSTOMER">Make customer</button>` : account.operatorRequestStatus === 'PENDING' ? `<button class="admin-row-action promote" data-view="admin-requests">Review request</button>` : ''}<button class="admin-row-action ${account.banned ? 'restore' : 'ban'}" data-set-ban="${account._id}" data-banned="${account.banned}">${account.banned ? 'Unban' : 'Ban'}</button></div></td></tr>`).join('')
        : `<tr><td colspan="6" class="admin-table-empty">No ${role === 'CUSTOMER' ? 'customers' : 'operators'} yet.</td></tr>`
    const machineRows = this.machines.length
      ? this.machines.map((machine, index) => {
        const vendorName = typeof machine.vendor === 'object' && machine.vendor ? machine.vendor.name : 'Unassigned'
        return `<tr data-admin-searchable data-admin-search="${escapeHtml(`${machine.code} ${machine.name} ${machine.address} ${vendorName}`.toLowerCase())}"><td>${index + 1}</td><td><strong>${escapeHtml(machine.code)}</strong></td><td>${escapeHtml(machine.name)}</td><td><span class="admin-badge machine-${machine.status.toLowerCase()}">${escapeHtml(machine.status === 'ONLINE' ? 'Online' : machine.status === 'OFFLINE' ? 'Offline' : 'Maintenance')}</span></td><td><button class="admin-row-action view" data-machine-details="${machine._id}">Details</button></td></tr>`
      }).join('')
      : '<tr><td colspan="5" class="admin-table-empty">No machines found.</td></tr>'
    const assignmentRows = this.machines.length
      ? this.machines.map(machine => {
        const vendorId = typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id || ''
        return `<tr><td><strong>${escapeHtml(machine.code)}</strong><small>${escapeHtml(machine.name)} · ${escapeHtml(machine.address)}</small></td><td><label class="admin-assignment-select"><span class="sr-only">Operator for ${escapeHtml(machine.code)}</span><select data-admin-machine-assignment="${machine._id}"><option value="">Unassigned</option>${operators.map(operator => `<option value="${operator._id}" ${operator._id === vendorId ? 'selected' : ''} ${operator.banned ? 'disabled' : ''}>${escapeHtml(operator.name)}${operator.banned ? ' · suspended' : ''}</option>`).join('')}</select></label></td><td><span class="admin-badge machine-${machine.status.toLowerCase()}">${escapeHtml(machine.status === 'ONLINE' ? 'Online' : machine.status === 'OFFLINE' ? 'Offline' : 'Maintenance')}</span></td></tr>`
      }).join('')
      : '<tr><td colspan="3" class="admin-table-empty">No machines found.</td></tr>'
    const complaintRows = openComplaints.length
      ? openComplaints.slice(0, 6).map((complaint, index) => `<tr data-admin-searchable data-admin-search="${escapeHtml(`${complaint.reference} ${complaint.category} ${complaint.subject} ${complaint.customer?.name || ''} ${complaint.message}`.toLowerCase())}"><td>${index + 1}</td><td><span class="admin-badge issue-type">${escapeHtml(complaint.category)}</span></td><td>${escapeHtml(complaint.customer?.name || 'Customer')}</td><td><strong>${escapeHtml(complaint.subject)}</strong><small>${escapeHtml(complaint.reference)}</small></td><td><span class="admin-badge issue-open">Open</span></td><td><button class="admin-row-action view" data-resolve-complaint="${complaint._id}">Review</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="admin-table-empty">No open support issues. You are all caught up.</td></tr>'
    const operatorRequestRows = operatorRequests.length
      ? operatorRequests.map((account, index) => `<tr data-admin-searchable data-admin-search="${escapeHtml(`${account.name} ${account.email} operator request`.toLowerCase())}"><td>${index + 1}</td><td><span class="admin-person"><i>${escapeHtml(initials(account.name))}</i><strong>${escapeHtml(account.name)}</strong></span></td><td>${escapeHtml(account.email)}</td><td>${account.operatorRequestedAt ? formatDate(account.operatorRequestedAt) : '—'}</td><td><button class="admin-row-action promote" data-review-operator-request="${account._id}" data-approved="true">Approve</button></td><td><button class="admin-row-action ban" data-review-operator-request="${account._id}" data-approved="false">Decline</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="admin-table-empty">No pending operator requests.</td></tr>'
    const requestSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('settings', 17)} Operator access requests</h2><span class="admin-panel-note">${operatorRequests.length} pending</span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Applicant</th><th>Email</th><th>Requested</th><th>Approve</th><th>Decline</th></tr></thead><tbody>${operatorRequestRows}</tbody></table></div></section>`
    const userSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('grid', 17)} Users management</h2><label class="admin-table-search">${icon('search', 14)}<input data-admin-table-search="CUSTOMER" placeholder="Search users by name, email..."></label></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead><tbody>${accountRows(customers, 'CUSTOMER')}</tbody></table></div></section>`
    const operatorSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('settings', 17)} Operators management</h2><label class="admin-table-search">${icon('search', 14)}<input data-admin-table-search="OPERATOR" placeholder="Search operators by name, email..."></label></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Assigned machines</th><th>Status</th><th>Actions</th></tr></thead><tbody>${accountRows(operators, 'OPERATOR')}</tbody></table></div></section>`
    const machineSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('pin', 17)} Machines</h2><span class="admin-panel-note">${this.machines.length} total</span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Machine ID</th><th>Location</th><th>Status</th><th>Details</th></tr></thead><tbody>${machineRows}</tbody></table></div></section>`
    const assignmentSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('repeat', 17)} Machine assignment</h2><span class="admin-panel-note">${assignedMachineCount} of ${this.machines.length} assigned</span></div><p class="audit-log-intro">Assign each machine to an active operator. Changes are recorded in the audit log.</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Machine</th><th>Assigned operator</th><th>Status</th></tr></thead><tbody>${assignmentRows}</tbody></table></div></section>`
    const supportSection = `<section class="panel admin-panel"><div class="admin-panel-heading"><h2>${icon('help', 17)} Support / issues</h2><span class="admin-panel-note">${openComplaints.length} open</span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Type</th><th>From</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead><tbody>${complaintRows}</tbody></table></div></section>`
    const auditRows = this.adminAuditLog.map(entry => {
      const changes = Object.entries(entry.changes || {}).map(([field, value]) => {
        const change = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
        const formatted = (item: unknown) => escapeHtml(typeof item === 'string' ? item : JSON.stringify(item))
        return `<span><strong>${escapeHtml(field)}</strong>${change && ('before' in change || 'after' in change) ? `: ${formatted(change.before ?? '—')} → ${formatted(change.after ?? '—')}` : `: ${formatted(value)}`}</span>`
      }).join('')
      return `<tr><td><strong>${escapeHtml(entry.actorName)}</strong><small>${escapeHtml(entry.actorEmail)}</small></td><td>${escapeHtml(entry.action)}</td><td><strong>${escapeHtml(entry.targetLabel)}</strong><small>${escapeHtml(entry.targetType)}${entry.targetId ? ` · ${escapeHtml(entry.targetId)}` : ''}</small></td><td class="audit-change-list">${changes || '—'}</td><td>${new Date(entry.createdAt).toLocaleString()}</td></tr>`
    }).join('')
    const auditSection = `<section class="panel admin-panel audit-log-panel"><div class="admin-panel-heading"><h2>${icon('clock', 17)} Admin audit log</h2><button class="button-secondary" data-action="refresh">${icon('repeat', 14)} Refresh</button></div><p class="audit-log-intro">A record of administrative changes, including who made them and when. Most recent actions appear first.</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Administrator</th><th>Action</th><th>Target</th><th>Changes</th><th>Date & time</th></tr></thead><tbody>${auditRows || `<tr><td colspan="5" class="admin-table-empty">No admin changes recorded yet.</td></tr>`}</tbody></table></div><p class="audit-log-note">Showing the latest ${this.adminAuditLog.length} audit entries.</p></section>`
    const pageTitle: Partial<Record<View, string>> = { accounts: 'Users', 'admin-requests': 'Operator requests', 'admin-users': 'Users', 'admin-operators': 'Operators', 'admin-machines': 'Machines', 'admin-assignment': 'Machine assignment', 'admin-support': 'Support / issues', 'admin-audit': 'Audit log' }
    const dashboard = `<section class="admin-welcome"><div><h1>Welcome ${escapeHtml(this.user?.name.split(' ')[0] || 'Admin')} <span>👋</span></h1><p>Manage users, operators, vending machines and support requests.</p></div><div class="admin-header-actions"><button class="admin-icon-button" data-action="refresh" aria-label="Refresh dashboard">${icon('repeat', 18)}</button><span class="admin-avatar">${escapeHtml(initials(this.user?.name || 'Admin'))}</span><strong class="admin-header-name">${escapeHtml(this.user?.name || 'Admin')}</strong></div></section>
    <section class="admin-kpis"><article class="admin-kpi"><span class="admin-kpi-icon blue">${icon('grid', 21)}</span><div><small>Total users</small><strong>${customers.length + operators.length}</strong><span>${customers.length} customers</span></div></article><article class="admin-kpi"><span class="admin-kpi-icon green">${icon('settings', 21)}</span><div><small>Total operators</small><strong>${operators.length}</strong><span>${activeOperators.length} active</span></div></article><article class="admin-kpi"><span class="admin-kpi-icon violet">${icon('pin', 21)}</span><div><small>Total machines</small><strong>${this.machines.length}</strong><span>${assignedMachineCount} assigned</span></div></article><article class="admin-kpi"><span class="admin-kpi-icon orange">${icon('help', 21)}</span><div><small>Open issues</small><strong>${openComplaints.length}</strong><span>${openComplaints.length ? 'Needs attention' : 'All caught up'}</span></div></article></section>
    <section class="admin-shortcuts" aria-label="Dashboard shortcuts"><button data-view="admin-users"><span class="admin-shortcut-icon blue">${icon('grid', 17)}</span><span><strong>Manage users</strong><small>Ban, unban and review accounts</small></span>${icon('arrow', 15)}</button><button data-view="admin-operators"><span class="admin-shortcut-icon green">${icon('settings', 17)}</span><span><strong>Manage operators</strong><small>View active operators and coverage</small></span>${icon('arrow', 15)}</button><button data-view="admin-machines"><span class="admin-shortcut-icon violet">${icon('pin', 17)}</span><span><strong>Machine assignment</strong><small>Assign machines to operators</small></span>${icon('arrow', 15)}</button><button data-view="admin-support"><span class="admin-shortcut-icon orange">${icon('help', 17)}</span><span><strong>Support & issues</strong><small>Review open customer requests</small></span>${icon('arrow', 15)}</button><button data-view="admin-audit"><span class="admin-shortcut-icon blue">${icon('clock', 17)}</span><span><strong>Admin audit log</strong><small>See recent changes by administrators</small></span>${icon('arrow', 15)}</button></section>`
    const pageContent = this.view === 'operations' ? dashboard
      : this.view === 'admin-requests' ? requestSection
        : this.view === 'admin-users' || this.view === 'accounts' ? userSection
          : this.view === 'admin-operators' ? operatorSection
            : this.view === 'admin-machines' ? machineSection
              : this.view === 'admin-assignment' ? assignmentSection
                : this.view === 'admin-support' ? supportSection
                  : this.view === 'admin-audit' ? auditSection
                    : dashboard
    const heading = this.view === 'operations' ? '' : `<section class="admin-page-heading"><div><span class="section-kicker">ADMIN CONTROL CENTER</span><h1>${escapeHtml(pageTitle[this.view] || 'Admin')}</h1><p>Manage ${escapeHtml((pageTitle[this.view] || 'admin').toLowerCase())} and review recent activity.</p></div><button class="button-secondary" data-action="refresh">${icon('repeat', 15)} Refresh</button></section>`
    return `${heading}${pageContent}`
  }

  private renderVendorDashboard() {
    const overview = this.overview
    if (!overview) return `<section class="ops-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> OPERATIONS DASHBOARD</div><h1>Welcome back, <em>${escapeHtml(this.user?.name.split(' ')[0] || 'there')}.</em></h1><p>Loading your latest machine, inventory, and sales data.</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh</button></section><div class="loading-card">Loading live operations data…</div>`

    const trendByDate = new Map((overview.salesTrend || []).map(row => [row.date, row]))
    const end = new Date()
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
    start.setUTCDate(start.getUTCDate() - (this.salesRange - 1))
    const chartRows = Array.from({ length: this.salesRange }, (_, index) => {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + index)
      const key = date.toISOString().slice(0, 10)
      return { date: key, sales: trendByDate.get(key)?.sales || 0 }
    })
    const maxSales = Math.max(1, ...chartRows.map(row => row.sales))
    const chartLabels = new Set([0, Math.floor((this.salesRange - 1) / 2), this.salesRange - 1])
    const topProducts = overview.topProducts || []
    const maxProductSales = Math.max(1, ...topProducts.map(row => row.units))
    const assignedMachines = this.user?.role === 'OPERATOR'
      ? this.machines.filter(machine => (typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id) === this.user?._id)
      : this.machines
    const machines = overview.machineAttendance?.length
      ? overview.machineAttendance.map(row => ({ ...row, machine: this.machines.find(machine => machine._id === row._id) }))
      : assignedMachines.map(machine => ({ ...machine, machine, onlineOrdersToday: 0, revenueToday: 0, utilization: 0 }))
    const restockRows = this.inventory.slice(0, 10)
    const openAlerts = overview.alerts.slice(0, 5)
    const recentOrders = overview.recentOrders.slice(0, 5)
    const openComplaints = this.complaints.filter(row => row.status === 'OPEN').slice(0, 4)
    const machineTiles = machines.slice(0, 6).map(row => {
      const machine = row.machine || this.machines.find(item => item._id === row._id)
      if (!machine) return ''
      const available = this.inventory.filter(item => item.machine._id === machine._id).reduce((total, item) => total + (item.available ?? Math.max(0, item.quantity - item.reserved)), 0)
      const stockRows = this.inventory.filter(item => item.machine._id === machine._id).length
      return `<article class="vendor-machine-card machine-status-row"><div class="vendor-machine-top"><span class="machine-status-icon">${icon('pin', 17)}</span><div><strong>${escapeHtml(machine.name)}</strong><small>${escapeHtml(machine.code)} · ${escapeHtml(machine.address)}</small></div><span class="vendor-status status-${machine.status.toLowerCase()}"><i></i>${escapeHtml(machine.status.toLowerCase())}</span></div><div class="vendor-machine-stats"><span>${stockRows} products</span><span>${available} units available</span><span>${row.onlineOrdersToday || 0} pickups today</span></div><div class="vendor-machine-actions">${this.user?.role === 'ADMIN' ? `<button class="text-button" data-edit-machine="${machine._id}">Edit</button>` : `<button class="text-button" data-machine-status="${machine._id}" data-status="${machine.status}">${machine.status === 'ONLINE' ? 'Set status' : 'Bring online'}</button>`}</div></article>`
    }).join('')
    const machineEmptyMessage = this.user?.role === 'OPERATOR'
      ? 'No machines are assigned to your operator account yet. Ask an administrator to assign your machines.'
      : 'No machines have been assigned yet.'
    const inventoryEmptyMessage = this.user?.role === 'OPERATOR' && machines.length === 0
      ? 'Inventory will appear after an administrator assigns machines to your operator account.'
      : 'No inventory records yet. Add stock to get started.'
    const inventoryRows = restockRows.map(row => {
      const available = row.available ?? Math.max(0, row.quantity - row.reserved)
      const low = available <= row.lowStockThreshold
      const discountActive = this.discountIsActive(row.expirationDate, row.discountPercent)
      const effectivePrice = discountActive ? Math.round(row.product.price * (1 - (row.discountPercent || 0) / 100) * 100) / 100 : row.product.price
      return `<tr><td><span class="dashboard-product">${imageFor(row.product)}<span>${escapeHtml(row.product.name)}</span></span></td><td>${escapeHtml(row.machine.name)}</td><td>${this.priceMarkup({ price: effectivePrice, originalPrice: discountActive ? row.product.price : undefined, discountPercent: discountActive ? row.discountPercent : undefined })}</td><td class="${available === 0 ? 'stock-zero' : low ? 'stock-low' : ''}">${available}</td><td><span class="inventory-state ${available === 0 ? 'out' : low ? 'low' : 'in'}"><i></i>${row.expirationDate && new Date(row.expirationDate).getTime() < Date.now() ? 'Expired · blocked' : available === 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock'}</span></td><td><button class="text-button" data-edit-inventory="${row._id}">Edit</button></td></tr>`
    }).join('')

    return `<section class="ops-welcome vendor-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> ${this.user?.role === 'ADMIN' ? 'ADMIN DASHBOARD' : 'VENDOR DASHBOARD'}</div><h1>Welcome back, <em>${escapeHtml(this.user?.name.split(' ')[0] || 'there')}.</em></h1><p>Manage your vending machines, products, inventory, and sales all in one place.</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh dashboard</button></section>
    <section class="vendor-kpis"><article class="vendor-kpi"><span class="vendor-kpi-icon blue">${icon('chart', 20)}</span><div><small>Total revenue · 30 days</small><strong>${this.money(overview.revenue30d)}</strong></div><span class="vendor-kpi-note">${overview.sales30d} completed sales</span></article><article class="vendor-kpi"><span class="vendor-kpi-icon green">${icon('cart', 20)}</span><div><small>Total sales · 30 days</small><strong>${overview.sales30d.toLocaleString()}</strong></div><span class="vendor-kpi-note">Completed pickups</span></article><article class="vendor-kpi"><span class="vendor-kpi-icon violet">${icon('wifi', 20)}</span><div><small>Active machines</small><strong>${overview.machines.online}<small class="kpi-total"> / ${overview.machines.total}</small></strong></div><span class="vendor-kpi-note">${overview.machines.total - overview.machines.online} need attention</span></article><article class="vendor-kpi"><span class="vendor-kpi-icon orange">${icon('box', 20)}</span><div><small>Low-stock items</small><strong>${overview.inventory.lowStock}</strong></div><span class="vendor-kpi-note">${overview.inventory.rows} inventory records</span></article></section>
    <div class="vendor-dashboard-grid"><div class="vendor-dashboard-main">
      <section class="panel vendor-panel sales-chart-panel" id="sales-chart"><div class="vendor-panel-heading"><div><span class="section-kicker">SALES OVERVIEW</span><h2>Sales <em>trend.</em></h2></div><div class="range-switch" aria-label="Sales chart range"><button data-sales-range="7" class="${this.salesRange === 7 ? 'selected' : ''}">7 days</button><button data-sales-range="30" class="${this.salesRange === 30 ? 'selected' : ''}">30 days</button></div></div><div class="sales-chart-summary"><strong>${overview.sales30d.toLocaleString()}<small> sales in the last 30 days</small></strong><span>${this.money(overview.revenue30d)} revenue</span></div>${overview.salesTrend.length ? `<div class="sales-chart" role="img" aria-label="Daily completed sales for the last ${this.salesRange} days">${chartRows.map((row, index) => `<div class="sales-bar-column" title="${row.date}: ${row.sales} sales"><span class="sales-bar" style="height:${Math.max(row.sales ? 8 : 2, row.sales / maxSales * 100)}%"></span><small>${chartLabels.has(index) ? new Date(`${row.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}</small></div>`).join('')}</div>` : `<div class="dashboard-empty">Completed sales will appear here as orders are picked up.</div>`}</section>
      <section class="panel vendor-panel machines-dashboard-panel" id="machines"><div class="vendor-panel-heading"><div><span class="section-kicker">CONNECTED LOCATIONS</span><h2>My <em>machines.</em></h2></div><span class="panel-count">${machines.length} locations</span>${['ADMIN', 'OPERATOR'].includes(this.user?.role || '') ? `<button class="button-secondary manage-stock-button" data-action="machine-editor">${icon('plus', 14)} Add machine</button>` : ''}</div><div class="vendor-machine-grid">${machineTiles || `<div class="dashboard-empty">${machineEmptyMessage}</div>`}</div></section>
      ${this.renderSuggestionBoard(true)}
      <section class="panel vendor-panel inventory-dashboard-panel" id="inventory"><div class="vendor-panel-heading"><div><span class="section-kicker">INVENTORY OVERVIEW</span><h2>Stock <em>at a glance.</em></h2></div><button class="button-secondary manage-stock-button" data-action="inventory-editor">${icon('plus', 14)} Manage inventory</button></div><div class="dashboard-table-wrap"><table class="dashboard-inventory-table"><thead><tr><th>Product</th><th>Machine</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>${inventoryRows || `<tr><td colspan="6" class="dashboard-empty">${inventoryEmptyMessage}</td></tr>`}</tbody></table></div>${this.inventory.length > restockRows.length ? `<p class="dashboard-table-note">Showing ${restockRows.length} of ${this.inventory.length} inventory records.</p>` : ''}</section>
      <section class="panel vendor-panel catalog-dashboard-panel" id="products"><div class="vendor-panel-heading"><div><span class="section-kicker">CATALOG MANAGEMENT</span><h2>Products <em>on the shelf.</em></h2></div><button class="button-secondary manage-stock-button" data-action="product-editor">${icon('plus', 14)} Add product</button></div><div class="dashboard-catalog-list">${this.catalogProducts.slice(0, 6).map(product => `<div class="dashboard-catalog-row"><span class="dashboard-product">${imageFor(product)}<span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</small></span></span><strong>${this.money(product.price)}</strong><button class="text-button" data-edit-product="${product._id}">Edit</button>${this.user?.role === 'ADMIN' ? `<button class="text-button danger" data-archive-product="${product._id}">Archive</button>` : ''}</div>`).join('') || '<div class="dashboard-empty">No active catalog products.</div>'}</div></section>
      <section class="panel vendor-panel forecast-panel" id="restock-requests"><div class="vendor-panel-heading"><div><span class="section-kicker">DEMAND PLANNING</span><h2>Restock <em>forecast.</em></h2></div><span class="panel-count">${this.forecast.length} products</span></div><div class="dashboard-table-wrap"><table class="dashboard-inventory-table forecast-dashboard-table"><thead><tr><th>Product / machine</th><th>Sold</th><th>Daily avg</th><th>Days left</th><th>Suggested</th></tr></thead><tbody>${this.forecast.slice(0, 8).map(row => `<tr><td><strong>${escapeHtml(row.product.name)}</strong><small>${escapeHtml(row.machine.name)}</small></td><td>${row.unitsSold}</td><td>${row.dailyAverage.toFixed(1)}</td><td>${row.daysRemaining === null ? '—' : `${row.daysRemaining}d`}</td><td>${row.suggestedRestock > 0 ? `<button class="restock-button" data-restock="${row.inventoryId}" data-quantity="${row.suggestedRestock}">+${row.suggestedRestock} units</button>` : '—'}</td></tr>`).join('') || `<tr><td colspan="5" class="dashboard-empty">Sales history will build a useful forecast.</td></tr>`}</tbody></table></div></section>
    </div><aside class="vendor-dashboard-aside">
      <section class="panel vendor-panel top-products-panel"><div class="vendor-panel-heading"><div><span class="section-kicker">BEST SELLERS</span><h2>Top <em>products.</em></h2></div></div>${topProducts.length ? `<div class="top-products-list">${topProducts.map((row, index) => `<div class="top-product-row"><span class="top-product-rank rank-${index + 1}">${index + 1}</span><div><strong>${escapeHtml(row.name)}</strong><small>${row.units.toLocaleString()} units sold</small></div><span class="top-product-share"><i style="width:${Math.max(8, row.units / maxProductSales * 100)}%"></i></span></div>`).join('')}</div>` : '<div class="dashboard-empty">Top products appear after completed sales.</div>'}</section>
      <section class="panel vendor-panel alerts-dashboard-panel" id="alerts"><div class="vendor-panel-heading"><div><span class="section-kicker">INVENTORY HEALTH</span><h2>Stock <em>alerts.</em></h2></div><span class="panel-count alert-count">${overview.alerts.length} open</span></div>${openAlerts.length ? `<div class="dashboard-alert-list">${openAlerts.map(alert => `<div class="dashboard-alert-row"><span class="alert-severity ${alert.severity.toLowerCase()}"></span><div><strong>${escapeHtml(alert.product?.name || alert.message)}</strong><small>${escapeHtml(alert.machine?.name || 'Machine')} · ${new Date(alert.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><button class="resolve-alert" data-resolve="${alert._id}" aria-label="Resolve alert">${icon('check', 15)}</button></div>`).join('')}</div>` : '<div class="dashboard-empty">No open stock alerts. You’re all caught up.</div>'}</section>
      <section class="panel vendor-panel transactions-panel" id="orders-panel"><div class="vendor-panel-heading"><div><span class="section-kicker">RECENT ACTIVITY</span><h2>Recent <em>orders.</em></h2></div><button class="text-button" data-view="orders">View all ${icon('arrow', 14)}</button></div>${recentOrders.length ? `<div class="dashboard-order-list">${recentOrders.map(order => `<div class="dashboard-order-row"><span class="order-status-icon status-${order.status.toLowerCase()}">${icon(order.status === 'DISPENSED' ? 'check' : 'cart', 15)}</span><div><strong>${escapeHtml(order.code)}</strong><small>${escapeHtml(order.machine?.name || 'VendSmart machine')} · ${new Date(order.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><b>${this.money(order.total)}</b></div>`).join('')}</div>` : '<div class="dashboard-empty">Recent orders will appear here.</div>'}</section>
      <section class="panel vendor-panel support-dashboard-panel" id="support-panel"><div class="vendor-panel-heading"><div><span class="section-kicker">CUSTOMER SUPPORT</span><h2>Open <em>requests.</em></h2></div><button class="text-button" data-view="support">View all ${icon('arrow', 14)}</button></div>${openComplaints.length ? `<div class="dashboard-alert-list">${openComplaints.map(complaint => `<button class="dashboard-complaint-row" data-resolve-complaint="${complaint._id}"><span class="alert-severity high"></span><span><strong>${escapeHtml(complaint.subject)}</strong><small>${escapeHtml(complaint.customer?.name || 'Customer')} · ${escapeHtml(complaint.reference)}</small></span>${icon('arrow', 14)}</button>`).join('')}</div>` : '<div class="dashboard-empty">No open support requests.</div>'}</section>
    </aside></div>`
  }

  private renderVendorPage(view: VendorView) {
    const pageDetails: Record<VendorView, { title: string; description: string; selectors: string[] }> = {
      'vendor-machines': { title: 'My machines', description: 'View and manage the vending machines assigned to your account.', selectors: ['#machines'] },
      'vendor-products': { title: 'Products', description: 'Manage the products available in your vending catalog.', selectors: ['#products'] },
      'vendor-inventory': { title: 'Inventory', description: 'Review stock, expiry dates, discounts, and restock recommendations.', selectors: ['#inventory', '#restock-requests'] },
      'vendor-sales': { title: 'Sales & analytics', description: 'Track sales trends and see which products are performing best.', selectors: ['#sales-chart', '.top-products-panel'] },
      'vendor-orders': { title: 'Orders', description: 'Review recent orders and pickup activity across your machines.', selectors: ['#orders-panel'] },
      'vendor-suggestions': { title: 'Product suggestions', description: 'Review customer requests and add popular products to your catalog.', selectors: ['#admin-suggestions'] },
      'vendor-alerts': { title: 'Alerts', description: 'Review stock and machine alerts that may need your attention.', selectors: ['#alerts'] },
      'vendor-support': { title: 'Support requests', description: 'Review and respond to open customer support requests.', selectors: ['#support-panel'] },
    }
    const page = pageDetails[view]
    if (!this.overview) return `<section class="ops-welcome vendor-welcome vendor-page-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> VENDOR WORKSPACE</div><h1>${escapeHtml(page.title)}<em>.</em></h1><p>${escapeHtml(page.description)}</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh</button></section><div class="loading-card">Loading vendor data…</div>`
    if (view === 'vendor-inventory') {
      const forecastTemplate = document.createElement('template')
      forecastTemplate.innerHTML = this.renderVendorDashboard()
      const forecast = forecastTemplate.content.querySelector<HTMLElement>('#restock-requests')?.outerHTML || ''
      return `<section class="ops-welcome vendor-welcome vendor-page-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> VENDOR WORKSPACE</div><h1>${escapeHtml(page.title)}<em>.</em></h1><p>${escapeHtml(page.description)}</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh</button></section><div class="vendor-page-panels">${this.renderMachineInventoryGroups()}${forecast}</div>`
    }
    const template = document.createElement('template')
    template.innerHTML = this.renderVendorDashboard()
    template.content.querySelectorAll<HTMLElement>('[data-view="orders"]').forEach(node => { node.dataset.view = 'vendor-orders' })
    template.content.querySelectorAll<HTMLElement>('[data-view="support"]').forEach(node => { node.dataset.view = 'vendor-support' })
    const panels = page.selectors.map(selector => template.content.querySelector<HTMLElement>(selector)?.outerHTML || '').join('')
    return `<section class="ops-welcome vendor-welcome vendor-page-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> VENDOR WORKSPACE</div><h1>${escapeHtml(page.title)}<em>.</em></h1><p>${escapeHtml(page.description)}</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh</button></section><div class="vendor-page-panels">${panels || '<div class="loading-card">Loading vendor data…</div>'}</div>`
  }

  private renderMachineInventoryGroups() {
    const machines = new Map<string, Machine>()
    for (const machine of this.machines) {
      if (this.user?.role === 'OPERATOR' && (typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id) !== this.user._id) continue
      machines.set(machine._id, machine)
    }
    for (const row of this.inventory) machines.set(row.machine._id, row.machine)

    const groups = [...machines.values()].map(machine => {
      const rows = this.inventory.filter(row => row.machine._id === machine._id)
      const availableUnits = rows.reduce((total, row) => total + (row.available ?? Math.max(0, row.quantity - row.reserved)), 0)
      const stockRows = rows.map(row => {
        const available = row.available ?? Math.max(0, row.quantity - row.reserved)
        const low = available <= row.lowStockThreshold
        const expired = Boolean(row.expirationDate && new Date(row.expirationDate).getTime() < Date.now())
        const discountActive = this.discountIsActive(row.expirationDate, row.discountPercent)
        const effectivePrice = discountActive ? Math.round(row.product.price * (1 - (row.discountPercent || 0) / 100) * 100) / 100 : row.product.price
        const status = expired ? 'Expired · blocked' : available === 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock'
        return `<tr><td><span class="dashboard-product">${imageFor(row.product)}<span>${escapeHtml(row.product.name)}</span></span></td><td>${this.priceMarkup({ price: effectivePrice, originalPrice: discountActive ? row.product.price : undefined, discountPercent: discountActive ? row.discountPercent : undefined })}</td><td class="${available === 0 ? 'stock-zero' : low ? 'stock-low' : ''}">${available} / ${row.quantity}</td><td><span class="inventory-state ${available === 0 ? 'out' : low ? 'low' : 'in'}"><i></i>${status}</span></td><td><button class="text-button" data-edit-inventory="${row._id}">Edit</button></td></tr>`
      }).join('')
      return `<details class="inventory-machine-group"><summary><span class="machine-status-icon">${icon('pin', 17)}</span><span class="inventory-machine-name"><strong>${escapeHtml(machine.name)}</strong><small>${escapeHtml(machine.code)} · ${escapeHtml(machine.address)}</small></span><span class="inventory-machine-count">${rows.length} product${rows.length === 1 ? '' : 's'} · ${availableUnits} units</span><span class="vendor-status status-${machine.status.toLowerCase()}"><i></i>${escapeHtml(machine.status.toLowerCase())}</span><span class="inventory-machine-chevron">${icon('chevron', 16)}</span></summary><div class="inventory-machine-stock">${rows.length ? `<div class="dashboard-table-wrap"><table class="dashboard-inventory-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>${stockRows}</tbody></table></div>` : `<div class="dashboard-empty">No inventory assigned to this machine yet.</div>`}</div></details>`
    }).join('')
    return `<section class="panel vendor-panel inventory-dashboard-panel" id="inventory"><div class="vendor-panel-heading"><div><span class="section-kicker">INVENTORY BY MACHINE</span><h2>Choose a machine to <em>view its stock.</em></h2></div><button class="button-secondary manage-stock-button" data-action="inventory-editor">${icon('plus', 14)} Manage inventory</button></div><p class="inventory-estimate-note">Missing dates show clearly marked demo estimates. Enter the real batch date with Edit to enable expiry blocking and discounts.</p><div class="inventory-machine-list">${groups || '<div class="dashboard-empty">No machines are assigned to your account yet.</div>'}</div></section>`
  }

  private renderOperationsPanel() {
    if (!this.user || !['ADMIN', 'OPERATOR'].includes(this.user.role)) return `<div class="empty-state"><h3>Operations access required</h3><p>Sign in with an operator or administrator account to continue.</p><button class="button-primary" data-action="account">Sign in</button></div>`
    return this.overview ? this.renderVendorDashboard() : this.renderLegacyOperationsPanel()
  }

  private renderLegacyOperationsPanel() {
    if (!this.user || !['ADMIN', 'OPERATOR'].includes(this.user.role)) return `<div class="empty-state"><h3>Operations access required</h3><p>Sign in with an operator account to continue.</p><button class="button-primary" data-action="account">Sign in</button></div>`
    const overview = this.overview

    return `<section class="ops-welcome"><div><div class="eyebrow"><span class="eyebrow-line"></span> YOUR OPERATIONS, AT A GLANCE</div><h1>Good morning, <em>${escapeHtml(this.user.name.split(' ')[0])}.</em></h1><p>Here’s what’s happening across your machines today.</p></div><button class="button-secondary" data-action="refresh">${icon('clock', 16)} Refresh data</button></section>${!overview ? `<div class="loading-card">Loading live operations data…</div>` : `<section class="metrics-grid"><article class="metric-card"><div class="metric-header"><span>Active machines</span><i class="metric-icon peach">${icon('pin', 18)}</i></div><strong>${overview.machines.online}<small> / ${overview.machines.total}</small></strong><span class="metric-caption"><i class="metric-positive"></i> machines reporting online</span></article><article class="metric-card"><div class="metric-header"><span>Orders · last 30 days</span><i class="metric-icon mint">${icon('cart', 18)}</i></div><strong>${overview.sales30d}</strong><span class="metric-caption">Successfully dispensed</span></article><article class="metric-card"><div class="metric-header"><span>Gross revenue · 30 days</span><i class="metric-icon lavender">${icon('chart', 18)}</i></div><strong>${this.money(overview.revenue30d)}</strong><span class="metric-caption">From completed pickups</span></article><article class="metric-card ${overview.inventory.lowStock ? 'metric-warn' : ''}"><div class="metric-header"><span>Needs a restock</span><i class="metric-icon yellow">${icon('box', 18)}</i></div><strong>${overview.inventory.lowStock}</strong><span class="metric-caption">${overview.inventory.rows} tracked machine items</span></article></section><section class="ops-grid"><div class="panel inventory-panel" id="inventory"><div class="panel-heading"><div><span class="section-kicker">INVENTORY HEALTH</span><h2>Restock <em>on your radar.</em></h2></div><span class="panel-count">${overview.recommendations.length} to look at</span><button class="button-secondary manage-stock-button" data-action="inventory-editor">${icon('plus', 14)} Add stock</button></div>${overview.recommendations.length ? `<div class="restock-list">${overview.recommendations.slice(0, 8).map(row => `<div class="restock-row"><div class="restock-visual">${imageFor(row.product)}</div><div class="restock-main"><strong>${escapeHtml(row.product.name)}</strong><span>${escapeHtml(row.machine.name)} · ${row.available} available</span></div><div class="restock-forecast"><strong>${row.daysRemaining === null ? '—' : `${row.daysRemaining}d`}</strong><span>stock left</span></div><button class="restock-button" data-restock="${row.inventoryId}" data-quantity="${Math.max(1, row.suggestedRestock)}">+${Math.max(1, row.suggestedRestock)} units</button></div>`).join('')}</div>` : `<div class="inline-empty">${icon('check', 18)} Everything is comfortably stocked.</div>`}<div class="stock-management">${this.inventory.length ? this.inventory.map(row => `<div class="stock-row"><div><strong>${escapeHtml(row.product.name)}</strong><span>${escapeHtml(row.machine.name)} · ${row.reserved} reserved</span></div><span class="stock-count">${Math.max(0, row.quantity - row.reserved)} / ${row.quantity}</span><button class="text-button" data-edit-inventory="${row._id}">Adjust</button></div>`).join('') : '<p class="inline-empty">No inventory rows yet. Add stock to get started.</p>'}</div></div><div class="panel alerts-panel" id="alerts"><div class="panel-heading"><div><span class="section-kicker">NEEDS A LOOK</span><h2>Open <em>alerts.</em></h2></div><span class="panel-count alert-count">${overview.alerts.length} open</span></div>${overview.alerts.length ? `<div class="alert-list">${overview.alerts.slice(0, 6).map(alert => `<div class="alert-row"><span class="alert-severity ${alert.severity.toLowerCase()}"></span><div><strong>${escapeHtml(alert.message)}</strong><span>${escapeHtml(alert.machine?.name || 'Machine')} · ${new Date(alert.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div><button class="resolve-alert" data-resolve="${alert._id}" aria-label="Resolve alert">${icon('check', 16)}</button></div>`).join('')}</div>` : `<div class="inline-empty">${icon('check', 18)} No open alerts. Nice work.</div>`}</div><div class="panel sales-panel"><div class="panel-heading"><div><span class="section-kicker">LIVE FROM THE PICKUP SHELF</span><h2>Latest <em>orders.</em></h2></div><button class="text-button" data-view="orders">View all ${icon('arrow', 15)}</button></div>${overview.recentOrders.length ? `<div class="recent-order-list">${overview.recentOrders.map(order => `<div class="recent-order-row"><span class="recent-order-avatar">${icon('cart', 15)}</span><div><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.machine?.name || 'VendSmart machine')} · ${new Date(order.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div><b>${this.money(order.total)}</b><span class="status-mini status-${order.status.toLowerCase()}">${escapeHtml(order.status.toLowerCase())}</span></div>`).join('')}</div>` : `<div class="inline-empty">Completed pickups will show up here.</div>`}</div><div class="panel machine-panel"><div class="panel-heading"><div><span class="section-kicker">CONNECTED LOCATIONS</span><h2>Machines <em>in view.</em></h2></div><span class="panel-count">${this.machines.length} locations</span>${this.user.role === 'ADMIN' ? `<button class="button-secondary manage-stock-button" data-action="machine-editor">${icon('plus', 14)} Add machine</button>` : ''}</div><div class="machine-status-list">${this.machines.map(machine => `<div class="machine-status-row"><div class="machine-status-icon">${icon('pin', 17)}</div><div><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.code)} · ${escapeHtml(machine.address)}</span></div><span class="status-pill status-${machine.status.toLowerCase()}"><i></i>${escapeHtml(machine.status.toLowerCase())}</span>${this.user?.role === 'ADMIN' ? `<button class="status-toggle" data-edit-machine="${machine._id}">Edit</button>` : `<button class="status-toggle" data-machine-status="${machine._id}" data-status="${machine.status}">${machine.status === 'ONLINE' ? 'Set status' : 'Bring online'}</button>`}</div>`).join('')}</div></div><div class="panel product-panel"><div class="panel-heading"><div><span class="section-kicker">CATALOG MANAGEMENT</span><h2>Products <em>on the shelf.</em></h2></div><button class="button-secondary manage-stock-button" data-action="product-editor">${icon('plus', 14)} Add product</button></div><div class="catalog-management">${this.catalogProducts.length ? this.catalogProducts.map(product => `<div class="catalog-row"><div class="catalog-row-image">${imageFor(product)}</div><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</span></div><span class="catalog-price">${this.money(product.price)}</span><button class="text-button" data-edit-product="${product._id}">Edit</button>${this.user?.role === 'ADMIN' ? `<button class="text-button archive-product" data-archive-product="${product._id}">Archive</button>` : ''}</div>`).join('') : '<div class="inline-empty">No active products yet.</div>'}</div></div><div class="panel forecast-panel"><div class="panel-heading"><div><span class="section-kicker">30-DAY DEMAND PROJECTION</span><h2>Forecast <em>by machine.</em></h2></div><span class="panel-count">${this.forecast.length} products</span></div><div class="forecast-table"><div class="forecast-row forecast-header"><span>PRODUCT / LOCATION</span><span>UNITS SOLD</span><span>DAILY AVG</span><span>DAYS LEFT</span><span>RESTOCK</span></div>${this.forecast.slice(0, 12).map(row => `<div class="forecast-row"><span><strong>${escapeHtml(row.product.name)}</strong><small>${escapeHtml(row.machine.name)}</small></span><span>${row.unitsSold}</span><span>${row.dailyAverage.toFixed(1)}</span><span>${row.daysRemaining === null ? '—' : `${row.daysRemaining}d`}</span><span>${row.suggestedRestock > 0 ? `+${row.suggestedRestock}` : '—'}</span></div>`).join('') || '<div class="inline-empty">Dispensed sales will build your demand forecast.</div>'}</div></div></section><div class="forecast-note">${icon('spark', 16)} Restock suggestions use a 30-day rolling average of completed sales and target roughly one week of stock. No sales history? Thresholds still keep low stock on your radar.</div>`}`
  }

  private paymentLines() {
    if (this.paymentReservation) {
      const order = this.paymentReservation
      const units = (order.items || []).reduce((total, item) => total + item.quantity, 0)
      const fallback = order.total / Math.max(1, units)
      return (order.items || []).map(item => ({ name: item.name, quantity: item.quantity, lineTotal: Math.round((item.unitPrice ?? fallback) * item.quantity * 100) / 100 }))
    }
    return (this.paymentDraft?.items || []).map(item => ({ name: item.name, quantity: item.quantity, lineTotal: Math.round(item.price * item.quantity * 100) / 100 }))
  }

  private renderPayment() {
    const order = this.paymentReservation
    const machine = this.machines.find(row => row._id === (order?.machine?._id || this.paymentDraft?.machineId || this.selectedMachine))
    const lines = this.paymentLines()
    const total = order ? order.total : Math.round(lines.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100
    const card = this.paymentMethod === 'CARD'
    return `<section class="page-heading payment-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> SECURE CHECKOUT</div><h1>One last step,<br><em>then it's yours.</em></h1><p>Pay by card or UPI and we'll hold your picks at ${escapeHtml(machine?.name || 'your machine')} with a pickup code.</p></div><button class="button-secondary" data-action="back-to-bag">${icon('cart', 15)} Back to bag</button></section><section class="payment-layout"><div class="payment-panel"><div class="payment-panel-head"><span class="section-kicker">PAYMENT METHOD</span><h2>How would you like <em>to pay?</em></h2>${order ? `<small>Paying for order ${escapeHtml(order.code)} — your stock hold is still open.</small>` : ''}</div><div class="method-tabs" role="tablist" aria-label="Payment method"><button class="method-tab ${card ? 'selected' : ''}" data-pay-method="CARD" role="tab" aria-selected="${card}">${icon('card', 16)} Card</button><button class="method-tab ${card ? '' : 'selected'}" data-pay-method="UPI" role="tab" aria-selected="${!card}">${icon('spark', 16)} UPI</button></div><form id="payment-form" class="payment-form" novalidate><div class="card-fields" data-method-panel="CARD" ${card ? '' : 'hidden'}><label>Card number<input name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="19"></label><label>Name on card<input name="cardName" autocomplete="cc-name" placeholder="ALEX MORGAN" maxlength="80"></label><div class="field-row"><label>Expiry<input name="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5"></label><label>CVV<input name="cvv" type="password" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></label></div><p class="field-hint">Demo checkout — any test card works, for example 4242 4242 4242 4242. Card details never leave this page; only the last four digits reach our server.</p></div><div class="card-fields" data-method-panel="UPI" ${card ? 'hidden' : ''}><label>UPI ID<input name="upiId" autocomplete="off" placeholder="yourname@bank" maxlength="96"></label><p class="field-hint">Demo checkout — any valid UPI ID works, for example alex@okbank. Only a payment reference is stored, never the UPI ID.</p></div><div class="form-error" id="payment-error" role="alert"></div><button class="button-primary pay-button" type="submit">${icon('lock', 15)} Pay ${this.money(total)}</button><small class="secure-note">${icon('lock', 13)} Payments are simulated in this demo environment. No card is charged.</small></form></div><aside class="pay-summary"><span class="section-kicker">ORDER SUMMARY</span><h3>${escapeHtml(machine?.name || 'VendSmart pickup')}</h3><small class="pay-summary-address">${icon('pin', 13)} ${escapeHtml(machine?.address || 'Choose a pickup machine')}</small><div class="summary-lines">${lines.map(line => `<div class="summary-line"><span>${escapeHtml(line.name)} <b>× ${line.quantity}</b></span><strong>${this.money(line.lineTotal)}</strong></div>`).join('')}</div><div class="summary-total"><span>Total due</span><strong>${this.money(total)}</strong></div>${this.currencyRateNote() ? `<p class="pay-conversion-note">Converted for display only at ${this.currencyRateNote()} — this demo records the order in USD.</p>` : ''}<ul class="summary-points"><li>${icon('check', 13)} Pickup code valid for 15 minutes</li><li>${icon('check', 13)} Cancel free before you dispense</li><li>${icon('check', 13)} Pickup is always free</li></ul></aside></section>`
  }

  private renderSupport() {
    const staff = Boolean(this.user && ['ADMIN', 'OPERATOR'].includes(this.user.role))
    const open = this.complaints.filter(complaint => complaint.status === 'OPEN').length
    const orders = this.reservations.slice(0, 10).map(order => `<option value="${order._id}" ${this.complaintOrder === order._id ? 'selected' : ''}>${escapeHtml(order.code)} · ${escapeHtml(order.machine?.name || 'Pickup')} · ${this.money(order.total)}</option>`).join('')
    const contact = `<div class="contact-grid"><a class="contact-card" href="mailto:support@vendsmart.demo?subject=VendSmart%20support%20request"><span class="contact-icon">${icon('help', 18)}</span><div><strong>Email us</strong><span>support@vendsmart.demo</span><small>Replies within one business day</small></div></a><a class="contact-card" href="tel:+15550102030"><span class="contact-icon">${icon('bell', 18)}</span><div><strong>Call the support line</strong><span>+1 (555) 010-2030</span><small>Mon–Fri, 9am–6pm ET</small></div></a><div class="contact-card"><span class="contact-icon">${icon('pin', 18)}</span><div><strong>Problem at a machine?</strong><span>Use the form — include the order</span><small>We can see machine and order details</small></div></div></div>`
    const form = !this.user ? `<div class="empty-state support-signin"><div class="empty-icon">${icon('help', 23)}</div><h3>Sign in to send a complaint.</h3><p>We need your account so we can link the complaint to your order and reply to you.</p><button class="button-primary" data-action="account">${icon('arrow', 16)} Sign in to continue</button></div>` : `<form id="complaint-form" class="form-stack complaint-form"><div class="field-row"><label>What is the problem about?<select name="category" required>${COMPLAINT_CATEGORIES.map(category => `<option value="${category.value}">${category.label}</option>`).join('')}</select></label><label>Related order (optional)<select name="reservationId"><option value="">Not about a specific order</option>${orders}</select></label></div><label>Short title<input name="subject" maxlength="120" minlength="4" placeholder="e.g. Machine did not dispense my coffee" required></label><label>Tell us what happened<textarea name="message" rows="5" maxlength="2000" minlength="20" placeholder="Include the machine, what you expected and what went wrong. The more detail, the faster we can fix it." required></textarea></label><div class="form-error" id="complaint-error" role="alert"></div><button class="button-primary form-submit" type="submit">Send my complaint ${icon('arrow', 16)}</button><small class="field-hint">You'll get a reference number and can follow the status on this page.</small></form>`
    const list = this.complaints.length ? `<div class="complaint-list">${this.complaints.map(complaint => {
      const order = complaint.reservation && typeof complaint.reservation !== 'string' ? complaint.reservation : null
      const category = COMPLAINT_CATEGORIES.find(row => row.value === complaint.category)?.label || 'Other'
      return `<article class="complaint-card"><div class="complaint-top"><span class="complaint-ref">${escapeHtml(complaint.reference)}</span><span class="status-pill ${complaint.status === 'OPEN' ? 'status-pending' : ''}"><i></i>${complaint.status === 'OPEN' ? 'open' : 'resolved'}</span></div><strong>${escapeHtml(complaint.subject)}</strong><p>${escapeHtml(complaint.message)}</p><small class="complaint-meta">${escapeHtml(category)} · ${new Date(complaint.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${order ? ` · order ${escapeHtml(order.code)}` : ''}${staff && complaint.customer ? ` · ${escapeHtml(complaint.customer.name)}` : ''}</small>${complaint.response ? `<div class="complaint-response"><span>OUR REPLY</span><p>${escapeHtml(complaint.response)}</p></div>` : ''}${staff && complaint.status === 'OPEN' ? `<button class="button-secondary complaint-resolve" data-resolve-complaint="${complaint._id}">${icon('check', 14)} Mark resolved</button>` : ''}</article>`
    }).join('')}</div>` : `<div class="empty-state support-empty"><div class="empty-icon">${icon('check', 22)}</div><h3>${staff ? 'No complaints on file.' : 'Nothing reported yet.'}</h3><p>${staff ? 'Customer complaints will appear here as soon as they come in.' : 'When something goes wrong, send a complaint and track it here.'}</p></div>`
    return `<section class="page-heading support-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> CUSTOMER CARE</div><h1>Something not right?<br><em>We're on it.</em></h1><p>Tell us what happened — we'll link it to your order, keep a reference, and get back to you.</p></div><a class="button-secondary" href="mailto:support@vendsmart.demo">${icon('help', 15)} Email support</a></section><div class="support-layout"><div class="support-main"><section class="support-panel"><div class="panel-heading"><div><span class="section-kicker">TALK TO A HUMAN</span><h2>Reach us <em>directly.</em></h2></div><span class="panel-count">Mon–Fri</span></div>${contact}</section><section class="support-panel" id="complaint-panel"><div class="panel-heading"><div><span class="section-kicker">RAISE A COMPLAINT</span><h2>Tell us what <em>went wrong.</em></h2></div><span class="panel-count">${this.complaints.length} on file</span></div>${form}</section></div><aside class="support-side"><section class="support-panel"><div class="panel-heading"><div><span class="section-kicker">${staff ? 'ALL CUSTOMERS' : 'YOUR REQUESTS'}</span><h2>${staff ? 'Complaints <em>to review.</em>' : 'Tracking <em>your issue.</em>'}</h2></div><span class="panel-count ${open ? 'alert-count' : ''}">${open} open</span></div>${list}</section></aside></div>`
  }

  private startCheckout() {
    if (!this.user) { this.openAuth('login'); this.toast('Sign in to continue to payment.', 'info'); return }
    if (!this.cart.size) { this.toast('Your bag is waiting for something good.', 'error'); return }
    const items = this.products.filter(product => this.cart.has(product._id)).map(product => ({ productId: product._id, quantity: this.cart.get(product._id) || 0, name: product.name, price: product.price }))
    this.paymentDraft = { machineId: this.selectedMachine, items }
    this.paymentReservation = null
    this.paymentMethod = 'CARD'
    document.querySelector('#modal-root')!.innerHTML = ''
    this.view = 'payment'; location.hash = 'payment'; this.render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  private startOrderPayment(id: string) {
    const order = this.reservations.find(row => row._id === id)
    if (!order) { this.toast('That order is no longer available. Refresh and try again.', 'error'); return }
    if (order.status !== 'PENDING') { this.toast(order.status === 'PAID' ? 'This order is already paid.' : `This order is ${order.status.toLowerCase()} and cannot be paid.`, 'error'); return }
    this.paymentReservation = order
    this.paymentDraft = null
    this.paymentMethod = 'CARD'
    this.view = 'payment'; location.hash = 'payment'; this.render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  private luhnValid(value: string) {
    let total = 0
    let double = false
    for (let index = value.length - 1; index >= 0; index -= 1) {
      let digit = Number(value[index])
      if (double) { digit *= 2; if (digit > 9) digit -= 9 }
      total += digit
      double = !double
    }
    return value.length >= 12 && total % 10 === 0
  }

  private async submitPayment(form: FormData) {
    const errorNode = document.querySelector<HTMLDivElement>('#payment-error')
    const button = document.querySelector<HTMLButtonElement>('.pay-button')
    const method = this.paymentMethod
    const setError = (message: string) => { if (errorNode) errorNode.textContent = message; button?.removeAttribute('disabled'); if (button) button.innerHTML = `${icon('lock', 15)} Pay ${this.money(this.paymentReservation?.total || Math.round((this.paymentDraft?.items || []).reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100)}` }
    let body: { method: string; last4?: string; upiId?: string }
    if (method === 'CARD') {
      const digits = String(form.get('cardNumber') || '').replace(/\D/g, '')
      const name = String(form.get('cardName') || '').trim()
      const expiry = String(form.get('expiry') || '').trim()
      const cvv = String(form.get('cvv') || '').trim()
      if (!this.luhnValid(digits)) return setError('Check the card number — it does not look valid.')
      if (name.length < 2) return setError('Enter the name printed on the card.')
      const match = expiry.match(/^(\d{2})\s*\/\s*(\d{2})$/)
      if (!match) return setError('Enter the expiry date as MM/YY.')
      const month = Number(match[1]); const year = 2000 + Number(match[2])
      const expiryDate = new Date(year, month, 1)
      if (month < 1 || month > 12 || expiryDate <= new Date()) return setError('That card has expired.')
      if (!/^\d{3,4}$/.test(cvv)) return setError('Enter the 3 or 4 digit CVV.')
      body = { method: 'CARD', last4: digits.slice(-4) }
    } else {
      const upiId = String(form.get('upiId') || '').trim()
      if (!/^[a-z0-9._-]{2,64}@[a-z]{2,32}$/i.test(upiId)) return setError('Enter a valid UPI ID, for example name@bank.')
      body = { method: 'UPI', upiId }
    }
    if (errorNode) errorNode.textContent = ''
    this.busy = true
    if (button) { button.disabled = true; button.textContent = 'Processing payment…' }
    try {
      let target = this.paymentReservation
      if (!target) {
        if (!this.paymentDraft) throw new Error('Your bag is empty.')
        target = await this.request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify({ machineId: this.paymentDraft.machineId, paymentMethod: method, items: this.paymentDraft.items.map(item => ({ productId: item.productId, quantity: item.quantity })) }) })
        this.paymentReservation = target
      }
      const paid = await this.request<Reservation>(`/reservations/${target._id}/pay`, { method: 'POST', body: JSON.stringify(body) })
      this.cart.clear(); this.paymentDraft = null; this.paymentReservation = null
      await this.load()
      this.view = 'orders'; location.hash = 'orders'; this.render()
      this.showPickup(paid)
      this.toast(`Payment received — ${this.money(paid.total)} paid. Your pickup code is ready.`, 'success')
    } catch (error) {
      setError((error as Error).message)
    } finally { this.busy = false }
  }

  private async submitComplaint(form: FormData) {
    const errorNode = document.querySelector<HTMLDivElement>('#complaint-error')
    const button = document.querySelector<HTMLButtonElement>('#complaint-form .form-submit')
    const payload: Record<string, unknown> = {
      category: String(form.get('category') || ''),
      subject: String(form.get('subject') || '').trim(),
      message: String(form.get('message') || '').trim(),
    }
    const reservationId = String(form.get('reservationId') || '')
    if (reservationId) payload.reservationId = reservationId
    if (errorNode) errorNode.textContent = ''
    if (button) { button.disabled = true; button.textContent = 'Sending your complaint…' }
    try {
      const complaint = await this.request<Complaint>('/complaints', { method: 'POST', body: JSON.stringify(payload) })
      this.complaintOrder = ''
      this.complaints = await this.request<Complaint[]>('/complaints')
      this.render()
      this.toast(`Complaint ${complaint.reference} received — we'll reply by email.`, 'success')
    } catch (error) {
      if (errorNode) errorNode.textContent = (error as Error).message
      if (button) { button.disabled = false; button.innerHTML = `Send my complaint ${icon('arrow', 16)}` }
    }
  }

  private async submitSuggestion(form: FormData) {
    if (this.user?.role !== 'CUSTOMER') return this.toast('Sign in with a customer account to submit an idea.', 'error')
    const body = {
      name: String(form.get('name') || '').trim(),
      category: document.querySelector<HTMLSelectElement>('#suggestion-form select[name="name"]')?.selectedOptions[0]?.dataset.category || '',
      details: String(form.get('details') || '').trim(),
    }
    const button = document.querySelector<HTMLButtonElement>('#suggestion-form button[type="submit"]')
    if (button) { button.disabled = true; button.textContent = 'Sharing…' }
    try {
      const suggestion = await this.request<ProductSuggestion>('/suggestions', { method: 'POST', body: JSON.stringify(body) })
      this.suggestions = await this.request<ProductSuggestion[]>('/suggestions')
      this.render()
      this.toast(suggestion.votes > 1 ? 'That item was already suggested — your vote has been added.' : 'Your product suggestion has been shared.', 'success')
    } catch (error) {
      this.toast((error as Error).message, 'error')
      if (button) { button.disabled = false; button.textContent = 'Share suggestion' }
    }
  }

  private async toggleSuggestionVote(id: string) {
    if (this.user?.role !== 'CUSTOMER') return this.toast('Sign in with a customer account to vote.', 'error')
    try {
      const suggestion = await this.request<ProductSuggestion>(`/suggestions/${id}/vote`, { method: 'POST' })
      this.suggestions = this.suggestions.map(row => row._id === id ? suggestion : row)
      this.render()
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async reviewSuggestion(id: string, status: 'ADDED' | 'DECLINED', productId?: string) {
    if (!this.user || !['OPERATOR', 'ADMIN'].includes(this.user.role)) return this.toast('Operator access is required to review suggestions.', 'error')
    if (status === 'DECLINED' && !window.confirm('Decline this product suggestion?')) return
    try {
      await this.request<ProductSuggestion>(`/suggestions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, ...(productId ? { productId } : {}) }) })
      await this.load()
      this.toast(status === 'ADDED' ? 'Suggestion marked as added to the catalog.' : 'Suggestion declined.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private openComplaintResolver(id: string) {
    const complaint = this.complaints.find(row => row._id === id)
    if (!complaint) return this.toast('Complaint could not be found. Refresh and try again.', 'error')
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card small-modal complaint-modal" role="dialog" aria-modal="true" aria-labelledby="complaint-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow" style="justify-content:center"><span class="eyebrow-line"></span> ${escapeHtml(complaint.reference)}</div><h2 id="complaint-title">${escapeHtml(complaint.subject)}</h2><p>${escapeHtml(complaint.customer?.name || 'Customer')} · ${escapeHtml(complaint.customer?.email || '')}</p><div class="complaint-modal-body"><p>${escapeHtml(complaint.message)}</p></div><form id="resolve-complaint-form" class="form-stack"><label>Reply to the customer (optional)<textarea name="response" rows="3" maxlength="1000" placeholder="What did we do to fix it?"></textarea></label><div class="form-error" id="resolve-error" role="alert"></div><button class="button-primary form-submit" type="submit">${icon('check', 15)} Mark resolved</button></form></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector<HTMLFormElement>('#resolve-complaint-form')?.addEventListener('submit', event => {
      event.preventDefault()
      const response = String(new FormData(event.currentTarget as HTMLFormElement).get('response') || '').trim()
      void this.resolveComplaint(complaint._id, response)
    })
  }

  private async resolveComplaint(id: string, response: string) {
    const button = document.querySelector<HTMLButtonElement>('#resolve-complaint-form .form-submit')
    if (button) { button.disabled = true; button.textContent = 'Saving…' }
    try {
      await this.request(`/complaints/${id}/resolve`, { method: 'PATCH', body: JSON.stringify(response ? { response } : {}) })
      document.querySelector('#modal-root')!.innerHTML = ''
      await this.load()
      this.toast('Complaint marked as resolved.', 'success')
    } catch (error) {
      const errorNode = document.querySelector<HTMLDivElement>('#resolve-error')
      if (errorNode) errorNode.textContent = (error as Error).message
      if (button) { button.disabled = false; button.innerHTML = `${icon('check', 15)} Mark resolved` }
    }
  }

  private reportOnOrder(id: string) {
    if (!this.user) { this.openAuth('login'); this.toast('Sign in to report a problem with an order.', 'info'); return }
    this.complaintOrder = id
    this.view = 'support'; location.hash = 'support'; this.render()
    window.setTimeout(() => document.querySelector('#complaint-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  private bindEvents() {
    document.querySelector<HTMLElement>('.staff-menu-toggle')?.addEventListener('click', event => {
      const button = event.currentTarget as HTMLElement
      const shell = button.closest<HTMLElement>('.app-shell')
      const isOpen = shell?.classList.toggle('mobile-nav-open') || false
      button.setAttribute('aria-expanded', String(isOpen))
      button.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu')
      button.innerHTML = icon(isOpen ? 'close' : 'menu', 20)
    })
    document.querySelector<HTMLElement>('.staff-nav-backdrop')?.addEventListener('click', () => {
      const shell = document.querySelector<HTMLElement>('.app-shell')
      shell?.classList.remove('mobile-nav-open')
      const button = shell?.querySelector<HTMLElement>('.staff-menu-toggle')
      button?.setAttribute('aria-expanded', 'false')
      button?.setAttribute('aria-label', 'Open navigation menu')
      if (button) button.innerHTML = icon('menu', 20)
    })
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(node => node.addEventListener('click', () => { const view = node.dataset.view as View; this.view = view; location.hash = view === 'store' ? 'store' : view; if (view === 'admin-audit') void this.load(); else this.render() }))
    document.querySelectorAll<HTMLSelectElement>('[data-currency]').forEach(node => node.addEventListener('change', () => this.setCurrency(node.value as CurrencyCode)))
    document.querySelectorAll<HTMLElement>('[data-action]').forEach(node => node.addEventListener('click', () => void this.handleAction(node.dataset.action || '', node)))
    document.querySelectorAll<HTMLElement>('[data-category]').forEach(node => node.addEventListener('click', () => { this.category = node.dataset.category || 'All items'; this.render() }))
    document.querySelectorAll<HTMLElement>('[data-favorite]').forEach(node => node.addEventListener('click', () => void this.toggleFavorite(node.dataset.favorite!)))
    document.querySelectorAll<HTMLElement>('[data-add]').forEach(node => node.addEventListener('click', () => { const id = node.dataset.add!; const product = this.products.find(row => row._id === id); if (product?.available !== undefined && (this.cart.get(id) || 0) >= product.available) return this.toast('That is all that is currently in stock.', 'error'); this.cart.set(id, (this.cart.get(id) || 0) + 1); this.render(); this.toast(`${product?.name || 'Item'} added to your bag.`, 'success') }))
    document.querySelector<HTMLSelectElement>('#machine-select')?.addEventListener('change', event => { void this.selectMachine((event.currentTarget as HTMLSelectElement).value) })
    document.querySelectorAll<HTMLElement>('[data-choose-machine]').forEach(node => node.addEventListener('click', () => void this.openMachineContents(node.dataset.chooseMachine!)))
    document.querySelectorAll<HTMLElement>('[data-recommend-machine]').forEach(node => node.addEventListener('click', () => void this.selectMachine(node.dataset.recommendMachine!)))
    document.querySelector<HTMLFormElement>('#smart-filter-form')?.addEventListener('submit', event => { event.preventDefault(); this.prompt = document.querySelector<HTMLInputElement>('#smart-filter-input')?.value.trim() || ''; void this.loadRecommendations() })
    document.querySelectorAll<HTMLElement>('[data-recommend]').forEach(node => node.addEventListener('click', () => { const product = this.products.find(row => row._id === node.dataset.recommend); if (product) { this.category = 'All items'; this.toast(`${product.name} is waiting in the menu.`, 'info'); document.querySelector(`[data-add="${product._id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }))
    const search = document.querySelector<HTMLInputElement>('#product-search')
    search?.addEventListener('input', () => { this.search = search.value; window.clearTimeout(this.searchTimer); this.searchTimer = window.setTimeout(() => void this.loadProducts().then(() => this.render()), 250) })
    search?.addEventListener('keydown', event => { if (event.key === 'Escape') { this.search = ''; void this.loadProducts().then(() => this.render()) } })
    document.querySelectorAll<HTMLElement>('[data-dispense]').forEach(node => node.addEventListener('click', () => void this.dispense(node.dataset.dispense!, node.dataset.otp)))
    document.querySelectorAll<HTMLElement>('[data-cancel]').forEach(node => node.addEventListener('click', () => void this.cancelReservation(node.dataset.cancel!)))
    document.querySelectorAll<HTMLElement>('[data-reorder]').forEach(node => node.addEventListener('click', () => void this.reorder(node.dataset.reorder!)))
    document.querySelectorAll<HTMLElement>('[data-pay]').forEach(node => node.addEventListener('click', () => this.startOrderPayment(node.dataset.pay!)))
    document.querySelectorAll<HTMLElement>('[data-report]').forEach(node => node.addEventListener('click', () => this.reportOnOrder(node.dataset.report!)))
    document.querySelectorAll<HTMLElement>('[data-resolve-complaint]').forEach(node => node.addEventListener('click', () => this.openComplaintResolver(node.dataset.resolveComplaint!)))
    document.querySelectorAll<HTMLFormElement>('#complaint-form').forEach(node => node.addEventListener('submit', event => { event.preventDefault(); void this.submitComplaint(new FormData(event.currentTarget as HTMLFormElement)) }))
    document.querySelector<HTMLFormElement>('#suggestion-form')?.addEventListener('submit', event => { event.preventDefault(); void this.submitSuggestion(new FormData(event.currentTarget as HTMLFormElement)) })
    document.querySelectorAll<HTMLElement>('[data-vote-suggestion]').forEach(node => node.addEventListener('click', () => void this.toggleSuggestionVote(node.dataset.voteSuggestion!)))
    document.querySelectorAll<HTMLElement>('[data-add-suggestion]').forEach(node => node.addEventListener('click', () => this.openProductEditor(undefined, node.dataset.addSuggestion)))
    document.querySelectorAll<HTMLElement>('[data-decline-suggestion]').forEach(node => node.addEventListener('click', () => void this.reviewSuggestion(node.dataset.declineSuggestion!, 'DECLINED')))
    document.querySelectorAll<HTMLElement>('[data-pay-method]').forEach(node => node.addEventListener('click', () => {
      this.paymentMethod = node.dataset.payMethod === 'UPI' ? 'UPI' : 'CARD'
      document.querySelectorAll<HTMLElement>('[data-pay-method]').forEach(tab => { const selected = tab.dataset.payMethod === this.paymentMethod; tab.classList.toggle('selected', selected); tab.setAttribute('aria-selected', String(selected)) })
      document.querySelectorAll<HTMLElement>('[data-method-panel]').forEach(panel => { panel.hidden = panel.dataset.methodPanel !== this.paymentMethod })
    }))
    document.querySelectorAll<HTMLInputElement>('#payment-form [name="cardNumber"]').forEach(node => node.addEventListener('input', () => { const digits = node.value.replace(/\D/g, '').slice(0, 16); node.value = digits.replace(/(.{4})/g, '$1 ').trim() }))
    document.querySelectorAll<HTMLInputElement>('#payment-form [name="expiry"]').forEach(node => node.addEventListener('input', () => { const digits = node.value.replace(/\D/g, '').slice(0, 4); node.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits }))
    document.querySelectorAll<HTMLInputElement>('#payment-form [name="cvv"]').forEach(node => node.addEventListener('input', () => { node.value = node.value.replace(/\D/g, '').slice(0, 4) }))
    document.querySelectorAll<HTMLFormElement>('#payment-form').forEach(node => node.addEventListener('submit', event => { event.preventDefault(); if (!this.busy) void this.submitPayment(new FormData(event.currentTarget as HTMLFormElement)) }))
    document.querySelectorAll<HTMLElement>('[data-edit-inventory]').forEach(node => node.addEventListener('click', () => this.openInventoryEditor(node.dataset.editInventory)))
    document.querySelectorAll<HTMLElement>('[data-edit-product]').forEach(node => node.addEventListener('click', () => this.openProductEditor(node.dataset.editProduct)))
    document.querySelectorAll<HTMLElement>('[data-edit-machine]').forEach(node => node.addEventListener('click', () => this.openMachineEditor(node.dataset.editMachine)))
    document.querySelectorAll<HTMLElement>('[data-machine-details]').forEach(node => node.addEventListener('click', () => void this.openMachineDetails(node.dataset.machineDetails!)))
    document.querySelectorAll<HTMLElement>('[data-set-ban]').forEach(node => node.addEventListener('click', () => void this.setAccountBan(node.dataset.setBan!, node.dataset.banned === 'true')))
    document.querySelectorAll<HTMLElement>('[data-set-role]').forEach(node => node.addEventListener('click', () => void this.setAccountRole(node.dataset.setRole!, node.dataset.roleTarget as 'CUSTOMER' | 'OPERATOR')))
    document.querySelectorAll<HTMLElement>('[data-review-operator-request]').forEach(node => node.addEventListener('click', () => void this.reviewOperatorRequest(node.dataset.reviewOperatorRequest!, node.dataset.approved === 'true')))
    const applyAdminSearch = () => {
      const globalQuery = document.querySelector<HTMLInputElement>('#admin-global-search')?.value.trim().toLowerCase() || ''
      const tableQueries = new Map(Array.from(document.querySelectorAll<HTMLInputElement>('[data-admin-table-search]')).map(input => [input.dataset.adminTableSearch || '', input.value.trim().toLowerCase()]))
      document.querySelectorAll<HTMLElement>('[data-admin-searchable]').forEach(row => {
        const role = row.dataset.adminRole || ''
        const rowSearch = row.dataset.adminSearch || ''
        const tableQuery = tableQueries.get(role) || ''
        row.hidden = !rowSearch.includes(globalQuery) || !rowSearch.includes(tableQuery)
      })
    }
    document.querySelector<HTMLInputElement>('#admin-global-search')?.addEventListener('input', applyAdminSearch)
    document.querySelectorAll<HTMLInputElement>('[data-admin-table-search]').forEach(input => input.addEventListener('input', applyAdminSearch))
    document.querySelectorAll<HTMLSelectElement>('[data-admin-machine-assignment]').forEach(select => select.addEventListener('change', async () => {
      const machineId = select.dataset.adminMachineAssignment!
      const machine = this.machines.find(row => row._id === machineId)
      if (!machine) return
      const previousVendorId = typeof machine.vendor === 'string' ? machine.vendor : machine.vendor?._id || ''
      const vendorId = select.value
      select.disabled = true
      try {
        await this.request<Machine>(`/machines/${machineId}`, { method: 'PATCH', body: JSON.stringify({ vendorId: vendorId || null }) })
        await this.load()
        this.toast('Machine operator assignment saved.', 'success')
      } catch (error) {
        select.value = previousVendorId
        select.disabled = false
        this.toast(`Could not assign this machine: ${(error as Error).message}`, 'error')
      }
    }))
    document.querySelector<HTMLInputElement>('#account-search')?.addEventListener('input', event => {
      this.adminSearch = (event.currentTarget as HTMLInputElement).value
      const query = this.adminSearch.trim().toLowerCase()
      let matches = 0
      document.querySelectorAll<HTMLElement>('[data-account-row]').forEach(row => {
        row.hidden = !row.dataset.search?.includes(query)
        if (!row.hidden) matches += 1
      })
      const empty = document.querySelector<HTMLElement>('#account-search-empty')
      if (empty) empty.hidden = !query || matches > 0
    })
    document.querySelectorAll<HTMLElement>('[data-archive-product]').forEach(node => node.addEventListener('click', () => void this.archiveProduct(node.dataset.archiveProduct!)))
    document.querySelectorAll<HTMLElement>('[data-resolve]').forEach(node => node.addEventListener('click', () => void this.resolveAlert(node.dataset.resolve!)))
    document.querySelectorAll<HTMLElement>('[data-restock]').forEach(node => node.addEventListener('click', () => { const row = this.inventory.find(item => item._id === node.dataset.restock); if (row) void this.restock(row, Number(node.dataset.quantity) || 1) }))
    document.querySelectorAll<HTMLElement>('[data-machine-status]').forEach(node => node.addEventListener('click', () => void this.toggleMachine(node.dataset.machineStatus!, node.dataset.status!)))
    document.querySelectorAll<HTMLElement>('[data-jump]').forEach(node => node.addEventListener('click', () => document.getElementById(node.dataset.jump!)?.scrollIntoView({ behavior: 'smooth' })))
    document.querySelectorAll<HTMLElement>('[data-sales-range]').forEach(node => node.addEventListener('click', () => {
      this.salesRange = node.dataset.salesRange === '30' ? 30 : 7
      this.render()
    }))
  }

  private async toggleFavorite(productId: string) {
    if (!this.user) { this.openAuth('login'); this.toast('Sign in to keep favorites across visits.', 'info'); return }
    const wasFavorite = this.favorites.has(productId)
    if (wasFavorite) this.favorites.delete(productId); else this.favorites.add(productId)
    this.render()
    try {
      await this.request(`/favorites${wasFavorite ? `/${productId}` : ''}`, { method: wasFavorite ? 'DELETE' : 'POST', ...(wasFavorite ? {} : { body: JSON.stringify({ productId }) }) })
      this.toast(wasFavorite ? 'Removed from favorites.' : 'Saved to favorites — find it under the Favorites tab.', 'success')
    } catch (error) {
      if (wasFavorite) this.favorites.add(productId); else this.favorites.delete(productId)
      this.render()
      this.toast((error as Error).message, 'error')
    }
  }

  private async selectMachine(id: string) {
    if (!this.machines.some(machine => machine._id === id && machine.status === 'ONLINE')) return
    this.selectedMachine = id
    this.cart.clear()
    await this.loadProducts()
    this.render()
  }

  private async locateMachines() {
    if (!navigator.geolocation) {
      this.locationStatus = 'This browser does not support location. Choose a machine from the list.'
      this.render()
      return
    }
    this.locationStatus = 'Finding nearby machines…'
    this.render()
    navigator.geolocation.getCurrentPosition(async position => {
      this.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }
      this.machines.sort((a, b) => {
        const first = machineLatLng(a)
        const second = machineLatLng(b)
        if (!first) return 1
        if (!second) return -1
        return distanceMeters([this.userLocation!.lat, this.userLocation!.lng], first) - distanceMeters([this.userLocation!.lat, this.userLocation!.lng], second)
      })
      const nearestAvailable = this.machines.find(machine => machine.status === 'ONLINE' && machineLatLng(machine))
      if (nearestAvailable) {
        this.selectedMachine = nearestAvailable._id
        this.cart.clear()
        await this.loadProducts()
        this.locationStatus = `Sorted by distance · GPS accuracy ±${Math.round(position.coords.accuracy)} m`
      } else {
        this.locationStatus = 'No mapped online machines are available. Choose a location manually.'
      }
      this.render()
    }, error => {
      this.locationStatus = error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. Choose a machine manually or enable location in browser settings.'
        : 'Could not get your location. Check your signal or choose a machine manually.'
      this.render()
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
  }

  private activeOrder(): Reservation | undefined {
    return this.reservations.find(order => ['PAID', 'PENDING'].includes(order.status) && order.machine)
  }

  private setRouteTarget(order?: Reservation) {
    const machine = order?.machine as Machine | string | undefined
    const machineId = typeof machine === 'string' ? machine : machine?._id
    const nextMachine = machineId ? this.machines.find(row => row._id === machineId) || null : null
    if (!nextMachine) { this.arrived = false; this.routeSteps = [] }
    this.pickupMachine = nextMachine
  }

  private syncRouteControls() {
    const live = this.pickupWatchId !== null
    const badge = document.querySelector<HTMLElement>('.live-gps-badge')
    if (badge) { badge.classList.toggle('on', live); badge.innerHTML = `<i></i>${live ? 'Live GPS on' : 'Live GPS off'}` }
    const toggle = document.querySelector<HTMLElement>('[data-action="toggle-live-route"]')
    if (toggle) toggle.innerHTML = `${icon('pin', 16)} ${live ? 'Stop live location' : 'Start live location'}`
    this.syncRoutePill()
  }

  private syncRoutePill() {
    const existing = document.querySelector<HTMLElement>('.live-route-pill')
    if (this.pickupWatchId === null || !this.pickupMachine) { existing?.remove(); return }
    const pill = existing || document.createElement('div')
    if (!existing) {
      pill.className = 'live-route-pill'
      pill.innerHTML = `<button class="pill-main" data-pill-view>${icon('pin', 15)}<span class="pill-copy"><strong></strong><small></small></span></button><button class="pill-stop" data-pill-stop aria-label="Stop live location">${icon('close', 14)}</button>`
      pill.querySelector('[data-pill-view]')?.addEventListener('click', () => {
        this.view = 'orders'; location.hash = 'orders'; this.render()
        document.querySelector('.live-route-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      pill.querySelector('[data-pill-stop]')?.addEventListener('click', () => this.stopRouteWatch())
      document.body.append(pill)
    }
    const value = pill.querySelector<HTMLElement>('.pill-copy strong')
    if (value) value.textContent = this.routeDistance
    const label = pill.querySelector<HTMLElement>('.pill-copy small')
    if (label) label.textContent = `Walking you to ${this.pickupMachine.name}`
  }

  private async autoStartRoute() {
    if (this.pickupWatchId !== null || !navigator.geolocation || !navigator.permissions?.query) return
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      if (permission.state === 'granted' && this.pickupWatchId === null && document.querySelector('#route-map')) this.startPickupTracking()
    } catch { /* Browsers without the Permissions API wait for the button. */ }
  }

  private renderLiveRoutePanel() {
    const order = this.activeOrder()
    if (!order || !this.pickupMachine) return ''
    const live = this.pickupWatchId !== null
    const directions = `https://www.openstreetmap.org/search?query=${encodeURIComponent(this.pickupMachine.address || this.pickupMachine.name)}`
    return `<section class="live-route-panel"><div class="live-route-heading"><div><span class="section-kicker">LIVE PICKUP ROUTE · ORDER ${escapeHtml(order.code)}</span><h2>Walking you to <em>${escapeHtml(this.pickupMachine.name)}</em></h2><small>${icon('pin', 13)} ${escapeHtml(this.pickupMachine.address)}</small></div><span class="live-gps-badge ${live ? 'on' : ''}"><i></i>${live ? 'Live GPS on' : 'Live GPS off'}</span></div><div class="live-route-layout"><div id="route-map" class="route-map" role="application" aria-label="Live map route to your pickup machine"></div><div class="live-route-side"><div class="live-route-arrival" id="route-arrival" ${this.arrived ? '' : 'hidden'}><span>YOU'RE HERE</span><strong>${escapeHtml(order.pickupOtp ? order.pickupOtp.match(/.{1,3}/g)?.join(' ') || '' : 'See your order card')}</strong><small>Enter this code at the machine to dispense.</small></div><span class="live-route-label">${icon('pin', 14)} LIVE WALKING GUIDE</span><strong id="route-distance">${escapeHtml(this.routeDistance)}</strong><small id="route-status">${escapeHtml(this.pickupStatus)}</small><ol class="live-route-steps" id="route-steps">${this.routeSteps.length ? this.routeSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('') : '<li>Route steps appear once live location finds your path.</li>'}</ol><button class="button-primary" data-action="toggle-live-route">${icon('pin', 16)} ${live ? 'Stop live location' : 'Start live location'}</button><a id="route-directions" href="${directions}" target="_blank" rel="noopener noreferrer">Open walking directions ↗</a><small class="live-route-note">Live location runs here on the page, so keep this tab open on your way. Device GPS is shared with the OpenStreetMap routing service only to calculate the route; no VendSmart account data is sent.</small></div></div></section>`
  }

  private mountMachineMap() {
    const container = document.querySelector<HTMLDivElement>('#machine-map')
    if (!container || !this.machines.length) return
    if (this.machineMap && this.machineMap.getContainer() === container) return
    this.machineMap?.remove()
    this.machineMap = null
    const points = this.machines.map(machine => ({ machine, point: machineLatLng(machine) })).filter((item): item is { machine: Machine; point: [number, number] } => Boolean(item.point))
    const initial = points[0]?.point || CAMPUS_CENTER
    this.machineMap = L.map(container, { scrollWheelZoom: false, zoomControl: true }).setView(initial, 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(this.machineMap)
    for (const { machine, point } of points) {
      const marker = L.marker(point, { icon: L.divIcon({ className: 'vendsmart-pin', html: '<span></span>', iconSize: [24, 32], iconAnchor: [12, 30] }) }).addTo(this.machineMap)
      marker.bindTooltip(escapeHtml(machine.name), { direction: 'top', offset: [0, -23] })
      marker.on('click', () => void this.openMachineContents(machine._id))
      this.machineMarkers.set(machine._id, marker)
    }
    if (this.userLocation) L.circleMarker([this.userLocation.lat, this.userLocation.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#5485c2', fillOpacity: 1 }).addTo(this.machineMap).bindTooltip('You are here')
    if (points.length > 1) this.machineMap.fitBounds(L.latLngBounds(points.map(item => item.point)).pad(0.16))
    else if (this.userLocation && points.length) this.machineMap.fitBounds(L.latLngBounds([initial, [this.userLocation.lat, this.userLocation.lng]]).pad(0.2))
    setTimeout(() => this.machineMap?.invalidateSize(), 0)
  }

  private mountRouteMap() {
    const container = document.querySelector<HTMLDivElement>('#route-map')
    if (!container) return
    const destination = this.pickupMachine ? machineLatLng(this.pickupMachine) : null
    if (!destination) {
      const status = document.querySelector<HTMLElement>('#route-status')
      if (status) status.textContent = 'Machine coordinates are unavailable. Open the address in directions instead.'
      return
    }
    if (this.pickupMap && this.pickupMap.getContainer() === container) return
    this.pickupRoute?.remove()
    this.pickupUserMarker?.remove()
    this.pickupMap?.remove()
    this.pickupMap = null
    this.pickupRoute = null
    this.pickupUserMarker = null
    this.lastRouteOrigin = null
    this.pickupMapFitted = false
    this.pickupMap = L.map(container, { scrollWheelZoom: false, zoomControl: true }).setView(destination, 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(this.pickupMap)
    this.pickupTargetMarker = L.marker(destination, { icon: L.divIcon({ className: 'vendsmart-pin pickup-target-pin', html: '<span></span>', iconSize: [24, 32], iconAnchor: [12, 30] }) }).addTo(this.pickupMap)
    this.pickupTargetMarker.bindTooltip(escapeHtml(this.pickupMachine?.name || 'Pickup machine'), { permanent: true, direction: 'top', offset: [0, -24] }).openTooltip()
    setTimeout(() => this.pickupMap?.invalidateSize(), 0)
    if (this.pickupWatchId !== null && this.userLocation) void this.updatePickupLocation(this.userLocation.lat, this.userLocation.lng, this.userLocation.accuracy)
    else void this.autoStartRoute()
  }

  private startPickupTracking() {
    if (!navigator.geolocation) {
      this.pickupStatus = 'This browser does not support live location.'
      this.updatePickupStatus()
      return
    }
    if (this.pickupWatchId !== null) return
    this.pickupStatus = 'Waiting for GPS permission…'
    this.updatePickupStatus()
    this.pickupWatchId = navigator.geolocation.watchPosition(position => {
      this.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }
      void this.updatePickupLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy)
    }, error => {
      this.pickupStatus = error.code === error.PERMISSION_DENIED
        ? 'Location access denied. Allow it in browser settings to enable live guidance.'
        : 'Waiting for a better GPS signal. You can still open walking directions.'
      this.updatePickupStatus()
      if (this.pickupWatchId !== null) navigator.geolocation.clearWatch(this.pickupWatchId)
      this.pickupWatchId = null
      this.updatePickupStatus()
      this.syncRouteControls()
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 })
    this.syncRouteControls()
  }

  private async updatePickupLocation(lat: number, lng: number, accuracy: number) {
    const from: [number, number] = [lat, lng]
    const destination = this.pickupMachine ? machineLatLng(this.pickupMachine) : null
    if (!destination || !this.pickupMap) return
    const straightDistance = distanceMeters(from, destination)
    if (!this.arrived && straightDistance <= 50) {
      this.arrived = true
      const banner = document.querySelector<HTMLElement>('#route-arrival')
      if (banner) banner.hidden = false
      this.pickupStatus = 'You have arrived — enter your pickup code at the machine.'
      this.updatePickupStatus()
      this.toast('You have arrived — your pickup code is on screen.', 'success')
    }
    this.pickupUserMarker?.setLatLng(from)
    if (!this.pickupUserMarker) this.pickupUserMarker = L.circleMarker(from, { radius: 8, color: '#fff', weight: 3, fillColor: '#5485c2', fillOpacity: 1 }).addTo(this.pickupMap).bindTooltip('Your live location')
    if (!this.pickupMapFitted) {
      this.pickupMap.fitBounds(L.latLngBounds([from, destination]).pad(0.25))
      this.pickupMapFitted = true
    }
    const directionLink = document.querySelector<HTMLAnchorElement>('#route-directions')
    if (directionLink) directionLink.href = walkingDirectionsUrl(from, destination)
    const minutes = Math.max(1, Math.round(straightDistance / 75))
    const straightLine = `${formatDistance(straightDistance)} away · about ${minutes} min`
    if (!this.pickupRoute) { this.routeDistance = straightLine; this.writeRouteDistance() }
    this.pickupStatus = `Live GPS · accuracy ±${Math.round(accuracy)} m · ${this.pickupRoute ? 'route follows your location' : 'finding your walking route…'}`
    this.updatePickupStatus()

    const now = Date.now()
    const previous = this.lastRouteOrigin
    if (this.routeController || (previous && now - this.lastRouteRequestedAt < 12000 && distanceMeters(previous, from) < 35)) return
    this.lastRouteOrigin = from
    this.lastRouteRequestedAt = now
    const controller = new AbortController()
    this.routeController = controller
    try {
      const routeUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${lng},${lat};${destination[1]},${destination[0]}?overview=full&geometries=geojson&steps=true`
      const response = await fetch(routeUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('Walking route unavailable')
      const result = await response.json() as { routes?: { geometry?: { coordinates?: [number, number][] }; distance?: number; duration?: number; legs?: { steps?: { distance?: number; name?: string; maneuver?: { type?: string; modifier?: string } }[] }[] }[] }
      const route = result.routes?.[0]
      const coordinates = route?.geometry?.coordinates
      if (!route || !coordinates?.length) throw new Error('No walking route found')
      const latLngs = coordinates.map(([routeLng, routeLat]) => [routeLat, routeLng] as [number, number])
      this.pickupRoute?.remove()
      this.pickupRoute = L.polyline(latLngs, { color: '#477b52', weight: 5, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }).addTo(this.pickupMap!)
      const routeMeters = route.distance || straightDistance
      const routeMinutes = Math.max(1, Math.ceil((route.duration || routeMeters / 1.25) / 60))
      this.routeDistance = `${formatDistance(routeMeters)} · about ${routeMinutes} min walking`
      this.writeRouteDistance()
      this.routeSteps = (route.legs?.[0]?.steps || []).map(step => describeRouteStep(step)).slice(0, 5)
      this.writeRouteSteps()
      this.pickupStatus = `Live GPS · accuracy ±${Math.round(accuracy)} m · route follows your location`
      this.updatePickupStatus()
    } catch (error) {
      if (controller.signal.aborted) return
      this.routeDistance = straightLine
      this.writeRouteDistance()
      this.routeSteps = []
      this.writeRouteSteps()
      this.pickupStatus = `Live GPS · accuracy ±${Math.round(accuracy)} m · showing direct distance; open directions for the walking route.`
      this.updatePickupStatus()
    } finally {
      if (this.routeController === controller) this.routeController = null
    }
  }

  private writeRouteSteps() {
    const node = document.querySelector<HTMLElement>('#route-steps')
    if (!node) return
    node.innerHTML = this.routeSteps.length ? this.routeSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('') : '<li>Route steps appear once live location finds your path.</li>'
  }

  private writeRouteDistance() {
    const node = document.querySelector<HTMLElement>('#route-distance')
    if (node) node.textContent = this.routeDistance
    const pillValue = document.querySelector<HTMLElement>('.live-route-pill strong')
    if (pillValue) pillValue.textContent = this.routeDistance
  }

  private updatePickupStatus() {
    const status = document.querySelector<HTMLElement>('#route-status')
    if (status) status.textContent = this.pickupStatus
  }

  private stopRouteWatch() {
    if (this.pickupWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(this.pickupWatchId)
    this.pickupWatchId = null
    this.routeController?.abort()
    this.routeController = null
    this.pickupRoute?.remove()
    this.pickupRoute = null
    this.pickupUserMarker?.remove()
    this.pickupUserMarker = null
    this.lastRouteOrigin = null
    this.lastRouteRequestedAt = 0
    this.routeSteps = []
    this.writeRouteSteps()
    this.pickupStatus = 'Live location paused. Start it again whenever you are on the move.'
    this.updatePickupStatus()
    this.syncRouteControls()
  }

  private stopPickupTracking() {
    this.stopRouteWatch()
    this.pickupMap?.remove()
    this.pickupMap = null
    this.pickupTargetMarker = null
    this.pickupMapFitted = false
  }

  private globalKeyHandler = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('#product-search')?.focus() }
  }

  private async handleAction(action: string, trigger?: HTMLElement) {
    if (action === 'account') return this.user ? this.openAccountMenu() : this.openAuth('login')
    if (action === 'suggestions') {
      this.view = 'suggestions'
      location.hash = 'suggestions'
      this.render()
      return
    }
    if (action === 'request-operator') return this.requestOperatorAccess(trigger instanceof HTMLButtonElement ? trigger : undefined)
    if (action === 'orders') { this.view = 'orders'; location.hash = 'orders'; this.render(); return }
    if (action === 'cart') return this.openCart()
    if (action === 'start-checkout') return this.startCheckout()
    if (action === 'back-to-bag') {
      if (this.paymentReservation) { this.paymentReservation = null; this.paymentDraft = null; this.view = 'orders'; location.hash = 'orders'; this.render(); this.toast('Your order is still unpaid — finish payment any time from My orders.', 'info'); return }
      this.paymentDraft = null
      this.view = 'store'; location.hash = 'store'; this.render()
      this.openCart()
      return
    }
    if (action === 'reset-search') { this.search = ''; this.category = 'All items'; await this.loadProducts(); this.render(); return }
    if (action === 'clear-prompt') { this.prompt = ''; this.recommendations = []; this.render(); return }
    if (action === 'locate-machines') { await this.locateMachines(); return }
    if (action === 'toggle-live-route') { if (this.pickupWatchId === null) this.startPickupTracking(); else this.stopRouteWatch(); return }
    if (action === 'refresh') { await this.load(); this.toast(this.view === 'admin-audit' ? 'Audit log refreshed.' : this.view.startsWith('admin-') ? 'Admin data refreshed.' : this.view === 'accounts' ? 'Account list refreshed.' : 'Operations data refreshed.', 'success') }
    if (action === 'inventory-editor') this.openInventoryEditor()
    if (action === 'machine-editor') this.openMachineEditor()
    if (action === 'product-editor') this.openProductEditor()
  }

  private async setAccountBan(id: string, currentlyBanned: boolean) {
    if (this.user?.role !== 'ADMIN') return this.toast('Only administrators can change account access.', 'error')
    const account = this.adminUsers.find(row => row._id === id)
    if (!account || account.role === 'ADMIN') return this.toast('This account cannot be changed.', 'error')
    const banned = !currentlyBanned
    if (banned && !window.confirm(`Ban ${account.name}? They will lose access to their customer or operator account.`)) return
    try {
      await this.request(`/users/${id}/ban`, { method: 'PATCH', body: JSON.stringify({ banned }) })
      this.adminUsers = this.adminUsers.map(row => row._id === id ? { ...row, banned, bannedAt: banned ? new Date().toISOString() : null } : row)
      this.render()
      this.toast(banned ? `${account.name} has been banned.` : `${account.name}'s access has been restored.`, 'success')
    } catch (error) {
      this.toast((error as Error).message, 'error')
    }
  }

  private async setAccountRole(id: string, role: 'CUSTOMER' | 'OPERATOR') {
    if (this.user?.role !== 'ADMIN') return this.toast('Only administrators can change account roles.', 'error')
    const account = this.adminUsers.find(row => row._id === id)
    if (!account || account.role === 'ADMIN') return this.toast('This account role cannot be changed.', 'error')
    if (account.banned && role === 'OPERATOR') return this.toast('Restore this account before making it an operator.', 'error')
    const action = role === 'OPERATOR' ? 'make an operator' : 'change to a customer'
    if (!window.confirm(`${role === 'OPERATOR' ? `Make ${account.name} an operator?` : `Change ${account.name} to a customer?`} ${role === 'OPERATOR' ? 'You can then assign vending machines to this account.' : 'This account must have no assigned machines.'}`)) return
    try {
      const updated = await this.request<Account>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
      this.adminUsers = this.adminUsers.map(row => row._id === id ? updated : row)
      this.render()
      this.toast(role === 'OPERATOR' ? `${account.name} is now an operator. Assign machines in the Machines section; they must sign out and back in to access operations.` : `${account.name} is now a customer.`, 'success')
    } catch (error) {
      this.toast(`Could not ${action}: ${(error as Error).message}`, 'error')
    }
  }

  private async reviewOperatorRequest(id: string, approved: boolean) {
    if (this.user?.role !== 'ADMIN') return this.toast('Only administrators can review operator requests.', 'error')
    const account = this.adminUsers.find(row => row._id === id && row.operatorRequestStatus === 'PENDING')
    if (!account) return this.toast('This operator request is no longer pending. Refresh and try again.', 'error')
    const decision = approved ? 'approve' : 'decline'
    if (!window.confirm(`${approved ? 'Approve' : 'Decline'} ${account.name}'s request for operator access?`)) return
    try {
      const updated = await this.request<Account>(`/users/${id}/operator-request`, { method: 'PATCH', body: JSON.stringify({ approved }) })
      this.adminUsers = this.adminUsers.map(row => row._id === id ? updated : row)
      this.render()
      this.toast(approved ? `${account.name} is now an operator. They can sign out and back in, then add machines.` : `${account.name}'s operator request was declined.`, 'success')
    } catch (error) {
      this.toast(`Could not ${decision} the operator request: ${(error as Error).message}`, 'error')
    }
  }

  private openAccountMenu() {
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    const requestStatus = this.user!.operatorRequestStatus || 'NONE'
    const operatorRequestAction = this.user!.role !== 'CUSTOMER' ? '' : requestStatus === 'PENDING'
      ? `<div class="operator-request-status pending">${icon('clock', 15)} Operator request pending administrator review.</div>`
      : requestStatus === 'APPROVED'
        ? `<div class="operator-request-status approved">${icon('check', 15)} Approved. Sign out and back in to activate your operator dashboard.</div>`
        : requestStatus === 'REJECTED'
          ? `<div class="operator-request-status rejected">Your previous request was declined. You can submit a new request.</div><button class="button-secondary modal-action" data-action="request-operator">${icon('settings', 16)} Request operator access</button>`
          : `<button class="button-secondary modal-action" data-action="request-operator">${icon('settings', 16)} Request operator access</button>`
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card small-modal" role="dialog" aria-modal="true" aria-label="Account settings"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="account-modal-avatar">${initials(this.user!.name)}</div><h2>${escapeHtml(this.user!.name)}</h2><p>${escapeHtml(this.user!.email)} · ${this.user!.role.toLowerCase()}</p>${operatorRequestAction}${this.user!.role !== 'CUSTOMER' ? `<button class="button-secondary modal-action" data-action="switch-ops">${icon('chart', 16)} Open operations overview</button>` : ''}<button class="button-secondary modal-action logout-button" data-action="logout">${icon('logout', 16)} Sign out</button></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector('[data-action="logout"]')?.addEventListener('click', () => { this.setUser(null); this.toast('You have signed out.', 'success'); root.innerHTML = '' })
    root.querySelector('[data-action="switch-ops"]')?.addEventListener('click', () => { this.view = 'operations'; location.hash = 'operations'; root.innerHTML = ''; this.render() })
    root.querySelector<HTMLButtonElement>('[data-action="request-operator"]')?.addEventListener('click', event => void this.requestOperatorAccess(event.currentTarget as HTMLButtonElement))
  }

  private async requestOperatorAccess(button?: HTMLButtonElement) {
    if (!this.user || this.user.role !== 'CUSTOMER') return
    if (button) { button.disabled = true; button.textContent = 'Submitting…' }
    try {
      const result = await this.request<{ operatorRequestStatus: 'PENDING'; operatorRequestedAt: string }>('/session/operator-request', { method: 'POST' })
      this.user = { ...this.user, operatorRequestStatus: result.operatorRequestStatus }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.user))
      this.render()
      this.openAccountMenu()
      this.toast('Operator access request sent to an administrator.', 'success')
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Request operator access' }
      this.toast(`Could not submit your request: ${(error as Error).message}`, 'error')
    }
  }

  private openAuth(mode: 'login' | 'register' = 'login') {
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    const isRegister = mode === 'register'
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="auth-mark">${icon('coffee', 22)}</div><div class="eyebrow"><span class="eyebrow-line"></span> ${isRegister ? 'MAKE YOURSELF AT HOME' : 'YOUR NEXT BREAK IS CLOSE'}</div><h2 id="auth-title">${isRegister ? 'A good thing starts here.' : 'Welcome back.'}</h2><p>${isRegister ? 'Create an account to save your orders and pickup codes.' : 'Sign in to see your orders and pick up right where you left off.'}</p><form id="auth-form" class="form-stack">${isRegister ? `<label>Your name<input name="name" autocomplete="name" placeholder="Alex Morgan" required minlength="2"></label>` : ''}<label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label><label>Password<input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" required minlength="8"></label><div class="form-error" id="auth-error" role="alert"></div><button class="button-primary form-submit" type="submit">${isRegister ? 'Create my account' : 'Sign in'} ${icon('arrow', 16)}</button></form><div class="auth-switch">${isRegister ? 'Already have an account?' : 'New around here?'} <button data-auth-switch>${isRegister ? 'Sign in' : 'Create an account'}</button></div><div class="auth-security">${icon('settings', 14)} New signups start as customers. Request operator access from your account; an administrator must approve it.</div></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector('[data-auth-switch]')?.addEventListener('click', () => this.openAuth(isRegister ? 'login' : 'register'))
    root.querySelector<HTMLFormElement>('#auth-form')?.addEventListener('submit', event => { event.preventDefault(); void this.submitAuth(new FormData(event.currentTarget as HTMLFormElement), isRegister) })
    setTimeout(() => root.querySelector<HTMLInputElement>('input')?.focus(), 50)
  }

  private async submitAuth(form: FormData, register: boolean) {
    const submit = document.querySelector<HTMLButtonElement>('.form-submit')!
    const errorNode = document.querySelector<HTMLDivElement>('#auth-error')!
    submit.disabled = true; submit.innerHTML = 'One moment…'
    try {
      const data = await this.request<User>(`/session/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }) })
      this.setUser(data); document.querySelector('#modal-root')!.innerHTML = ''; this.toast(`Welcome${register ? '' : ' back'}, ${data.name.split(' ')[0]}.`, 'success')
    } catch (error) { errorNode.textContent = (error as Error).message; submit.disabled = false; submit.innerHTML = `${register ? 'Create my account' : 'Sign in'} ${icon('arrow', 16)}` }
  }

  private openCart() {
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    if (!this.cart.size) { this.toast('Your bag is waiting for something good.', 'error'); return }
    if (!this.user) { this.openAuth('login'); this.toast('Sign in to reserve your items.', 'info'); return }
    const rows = this.products.filter(product => this.cart.has(product._id))
    const subtotal = rows.reduce((sum, product) => sum + product.price * (this.cart.get(product._id) || 0), 0)
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card cart-modal" role="dialog" aria-modal="true" aria-label="Your bag"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow"><span class="eyebrow-line"></span> A GOOD BREAK IS CLOSE</div><h2>Your little <em>pick-me-up.</em></h2><p class="cart-machine">${icon('pin', 15)} ${escapeHtml(this.machines.find(machine => machine._id === this.selectedMachine)?.name || 'Pickup machine')}</p><div class="cart-lines">${rows.map(product => `<div class="cart-line"><div class="cart-item-art visual-${rows.indexOf(product) % 6}">${imageFor(product)}</div><div class="cart-item-copy"><strong>${escapeHtml(product.name)}</strong><span>${this.money(product.price)} each</span></div><div class="quantity-control"><button data-quantity="${product._id}" data-delta="-1" aria-label="Remove one ${escapeHtml(product.name)}">${icon('minus', 14)}</button><strong>${this.cart.get(product._id)}</strong><button data-quantity="${product._id}" data-delta="1" aria-label="Add one ${escapeHtml(product.name)}">${icon('plus', 14)}</button></div><strong class="line-total">${this.money(product.price * (this.cart.get(product._id) || 0))}</strong></div>`).join('')}</div><div class="cart-total"><span>Subtotal <small>· pickup is free</small></span><strong>${this.money(subtotal)}</strong></div><div class="demo-payment-note">${icon('card', 15)} Pay by card or UPI on the next step — this demo simulates the payment and charges nothing.</div><button class="button-primary checkout-button" data-action="start-checkout">Continue to payment ${icon('arrow', 16)}</button><span class="cart-footnote">Your picks are held for 15 minutes after payment.</span></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelectorAll<HTMLElement>('.cart-line').forEach((node, index) => {
      const product = rows[index]
      if (!product) return
      const unit = node.querySelector<HTMLElement>('.cart-item-copy span')
      if (unit) unit.innerHTML = `${this.priceMarkup(product)} each · ${this.expirationLabel(product)}`
      const total = node.querySelector<HTMLElement>('.line-total')
      if (total) total.textContent = this.money(product.price * (this.cart.get(product._id) || 0))
    })
    root.querySelectorAll<HTMLElement>('[data-quantity]').forEach(node => node.addEventListener('click', () => { const id = node.dataset.quantity!; const count = (this.cart.get(id) || 0) + Number(node.dataset.delta); if (count > 0) this.cart.set(id, count); else this.cart.delete(id); this.openCart() }))
    root.querySelector('[data-action="start-checkout"]')?.addEventListener('click', () => this.startCheckout())
  }

  private showPickup(order: Reservation) {
    if (!order.otp) return
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    this.setRouteTarget(this.reservations.find(row => row._id === order._id) || order)
    this.pickupMapFitted = false
    root.innerHTML = `<div class="modal-backdrop"><section class="modal-card pickup-modal" role="dialog" aria-modal="true" aria-labelledby="pickup-title"><div class="pickup-confetti">✳</div><div class="eyebrow"><span class="eyebrow-line"></span> THAT WAS EASY</div><h2 id="pickup-title">Your good thing<br>is <em>waiting.</em></h2><p>We’ve held your picks at ${escapeHtml(this.pickupMachine?.name || 'your machine')}.</p><div class="pickup-live-note">${icon('pin', 15)} Your live walking map and GPS guide are on the My orders page, so they keep working while you browse.</div><div class="pickup-code-large"><span>YOUR 6-DIGIT PICKUP CODE</span><strong>${order.otp.match(/.{1,3}/g)?.join(' ')}</strong><small>Good for 15 minutes</small></div><div class="pickup-order-ref">ORDER ${escapeHtml(order.code)} <b>·</b> ${this.money(order.total)}</div><button class="button-secondary form-submit live-route-button" data-action="open-live-route">${icon('pin', 16)} Open live walking map</button><button class="button-primary form-submit" data-action="dispense-now" data-id="${order._id}">${icon('check', 16)} Dispense now</button><button class="text-button pickup-later" data-action="close-pickup">I’ll get it later — keep my code</button><div class="pickup-safety">Your code is private — enter it only at your selected machine.</div></section></div>`
    root.querySelector('[data-action="open-live-route"]')?.addEventListener('click', () => {
      root.innerHTML = ''
      this.view = 'orders'; location.hash = 'orders'; this.render()
      if (this.pickupWatchId === null) this.startPickupTracking()
      document.querySelector('.live-route-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    root.querySelector('[data-action="dispense-now"]')?.addEventListener('click', () => void this.dispense(order._id, order.otp))
    root.querySelector('[data-action="close-pickup"]')?.addEventListener('click', () => { root.innerHTML = ''; this.render() })
  }

  private async dispense(id: string, preset?: string) {
    const otp = preset || window.prompt('Enter the 6-digit pickup code shown in your order.') || undefined
    if (!otp) return
    try {
      await this.request(`/reservations/${id}/dispense`, { method: 'POST', body: JSON.stringify({ otp }) })
      this.stopPickupTracking(); document.querySelector('#modal-root')!.innerHTML = ''; await this.load(); this.toast('Pickup verified — enjoy your break!', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async cancelReservation(id: string) {
    if (!window.confirm('Cancel this reservation and release its held stock?')) return
    try {
      await this.request(`/reservations/${id}/cancel`, { method: 'POST' })
      await this.load()
      this.toast('Reservation cancelled and stock released.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private reorderLines(order: Reservation) {
    return (order.items || []).flatMap(item => (item.product && String(item.product) ? [{ productId: String(item.product), quantity: item.quantity }] : []))
  }

  private async reorder(id: string) {
    if (this.busy) return
    const order = this.reservations.find(row => row._id === id)
    if (!order) { this.toast('That order is no longer available. Refresh and try again.', 'error'); return }
    const machineId = typeof order.machine === 'string' ? order.machine : order.machine?._id
    const items = this.reorderLines(order)
    if (!machineId || !items.length) { this.toast('This order can’t be repeated — its items are no longer in the catalog.', 'error'); return }
    this.busy = true
    const button = document.querySelector<HTMLButtonElement>(`[data-reorder="${id}"]`)
    if (button) { button.disabled = true; button.textContent = 'Placing your order…' }
    try {
      const reservation = await this.request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify({ machineId, paymentMethod: 'DEMO', items }) })
      this.cart.clear()
      await this.load()
      this.view = 'orders'; location.hash = 'orders'; this.render()
      this.showPickup(reservation)
      this.toast('Same picks, new pickup code — your order is ready.', 'success')
    } catch (error) {
      if (button) { button.disabled = false; button.innerHTML = `${icon('repeat', 14)} Reorder these picks` }
      await this.fallbackReorder(machineId, items, (error as Error).message)
    } finally { this.busy = false }
  }

  // When the repeat order can't be placed as-is (stock moved, machine offline), load what is still available into the bag instead of failing silently.
  private async fallbackReorder(machineId: string, items: { productId: string; quantity: number }[], message: string) {
    const machine = this.machines.find(row => row._id === machineId && row.status === 'ONLINE')
    if (!machine) { this.toast(message, 'error'); return }
    this.selectedMachine = machine._id
    this.cart.clear()
    await this.loadProducts()
    let short = false
    for (const item of items) {
      const product = this.products.find(row => row._id === item.productId)
      if (!product) { short = true; continue }
      const quantity = Math.min(item.quantity, product.available ?? item.quantity)
      if (quantity > 0) this.cart.set(product._id, quantity)
      if (quantity < item.quantity) short = true
    }
    this.category = 'All items'; this.search = ''
    this.view = 'store'; location.hash = 'store'; this.render()
    if (!this.cart.size) { this.toast(message, 'error'); return }
    const suffix = short ? ` We’ve loaded your bag with what’s in stock at ${machine.name} so you can adjust and reserve.` : ''
    this.toast(`${message}${suffix}`, short ? 'info' : 'error')
  }

  private openInventoryEditor(id?: string, machineId?: string) {
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    const row = id ? this.inventory.find(item => item._id === id) : undefined
    if (id && !row) return this.toast('Inventory row could not be found. Refresh and try again.', 'error')
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow"><span class="eyebrow-line"></span> STOCK CONTROL</div><h2 id="inventory-title">${row ? 'Adjust inventory.' : 'Add machine stock.'}</h2><p>Available stock is calculated after active reservations.</p><form id="inventory-form" class="form-stack">${row ? '' : `<label>Machine<select name="machineId" required>${this.machines.map(machine => `<option value="${machine._id}" ${machine._id === machineId ? 'selected' : ''}>${escapeHtml(machine.name)}</option>`).join('')}</select></label><label>Product<select name="productId" required>${this.catalogProducts.map(product => `<option value="${product._id}">${escapeHtml(product.name)} · ${this.money(product.price)}</option>`).join('')}</select></label>`}<label>Total quantity<input name="quantity" type="number" min="${row?.reserved || 0}" step="1" value="${row?.quantity ?? 0}" required></label><label>Low-stock alert threshold<input name="lowStockThreshold" type="number" min="0" step="1" value="${row?.lowStockThreshold ?? 5}" required></label><label>Machine slot<input name="slot" maxlength="20" value="${escapeHtml(row?.slot || '')}" placeholder="e.g. A1"></label><button class="button-primary form-submit" type="submit">Save stock levels ${icon('check', 16)}</button>${row && row.reserved === 0 ? '<button class="button-secondary delete-stock" type="button">Remove inventory row</button>' : ''}</form></section></div>`
    const inventoryForm = root.querySelector<HTMLFormElement>('#inventory-form')
    inventoryForm?.querySelector<HTMLButtonElement>('button[type="submit"]')?.insertAdjacentHTML('beforebegin', `<label>Expiration date<input name="expirationDate" type="date" value="${row?.expirationDate?.slice(0, 10) || ''}" ${row ? '' : 'required'}></label><small class="field-hint">Existing stock without a date stays available until you record one. This date applies to every unit on this machine/product shelf.</small><label>Near-expiry discount (%)<input name="discountPercent" type="number" min="0" max="90" step="1" value="${row?.discountPercent || 0}" required></label><small class="field-hint">Optional. Discounts are active only during the final 7 days before expiry.</small>`)
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector<HTMLFormElement>('#inventory-form')?.addEventListener('submit', event => { event.preventDefault(); void this.saveInventory(new FormData(event.currentTarget as HTMLFormElement), row) })
    root.querySelector('.delete-stock')?.addEventListener('click', async () => {
      if (!row || !window.confirm(`Remove ${row.product.name} from ${row.machine.name}?`)) return
      try { await this.request(`/inventory/${row._id}`, { method: 'DELETE' }); root.innerHTML = ''; await this.load(); this.toast('Inventory row removed.', 'success') }
      catch (error) { this.toast((error as Error).message, 'error') }
    })
  }

  private openProductEditor(id?: string, suggestionId?: string) {
    if (!this.user || !['ADMIN', 'OPERATOR'].includes(this.user.role)) return this.toast('Operations access is required to manage products.', 'error')
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    const product = id ? this.catalogProducts.find(row => row._id === id) : undefined
    if (id && !product) return this.toast('Product could not be found. Refresh and try again.', 'error')
    const suggestion = suggestionId ? this.suggestions.find(row => row._id === suggestionId) : undefined
    if (suggestionId && !suggestion) return this.toast('Suggestion could not be found. Refresh and try again.', 'error')
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card inventory-modal" role="dialog" aria-modal="true" aria-labelledby="product-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow"><span class="eyebrow-line"></span> CATALOG MANAGEMENT</div><h2 id="product-title">${product ? 'Edit product.' : suggestion ? 'Add requested item.' : 'Add a product.'}</h2><p>${suggestion ? `Create a catalog product for “${escapeHtml(suggestion.name)}”. Saving also closes the suggestion.` : 'Changes update the shared catalog and customer storefront.'}</p><form id="product-form" class="form-stack"><label>Product name<input name="name" maxlength="120" value="${escapeHtml(product?.name || suggestion?.name || '')}" required></label><label>SKU<input name="sku" pattern="[A-Za-z0-9_-]{2,40}" maxlength="40" value="${escapeHtml(product?.sku || '')}" ${product ? 'disabled' : 'required'}></label><label>Category<input name="category" maxlength="80" value="${escapeHtml(product?.category || suggestion?.category || '')}" required></label><label>Price (USD)<input name="price" type="number" min="0" max="100000" step="0.01" value="${product?.price ?? ''}" required></label><label>Description<input name="description" maxlength="500" value="${escapeHtml(product?.description || suggestion?.details || '')}"></label><label>Image URL or emoji<input name="image" maxlength="2048" value="${escapeHtml(product?.image || '')}"></label><label>Tags (comma separated)<input name="tags" maxlength="660" value="${escapeHtml(product?.tags?.join(', ') || '')}" placeholder="vegan, protein"></label><button class="button-primary form-submit" type="submit">${suggestion ? 'Create product & close suggestion' : 'Save product'} ${icon('check', 16)}</button></form></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector<HTMLFormElement>('#product-form')?.addEventListener('submit', event => { event.preventDefault(); void this.saveProduct(new FormData(event.currentTarget as HTMLFormElement), product, suggestionId) })
  }

  private async saveProduct(form: FormData, product?: Product, suggestionId?: string) {
    const body: Record<string, unknown> = {
      name: String(form.get('name') || '').trim(),
      category: String(form.get('category') || '').trim(),
      price: Number(form.get('price')),
      description: String(form.get('description') || '').trim(),
      image: String(form.get('image') || '').trim(),
      tags: String(form.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean),
    }
    if (!product) body.sku = String(form.get('sku') || '').trim()
    try {
      const saved = await this.request<Product>(product ? `/products/${product._id}` : '/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      if (suggestionId) {
        try {
          await this.request(`/suggestions/${suggestionId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'ADDED', productId: saved._id }) })
        } catch (error) {
          document.querySelector('#modal-root')!.innerHTML = ''
          await this.load()
          this.toast(`Product created, but the suggestion is still open: ${(error as Error).message}`, 'error')
          return
        }
      }
      document.querySelector('#modal-root')!.innerHTML = ''
      await this.load()
      this.toast(suggestionId ? 'Product created and suggestion marked as added.' : product ? 'Product updated.' : 'Product created.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async archiveProduct(id: string) {
    const product = this.catalogProducts.find(row => row._id === id)
    if (!product || !window.confirm(`Archive ${product.name}? This is only allowed after its machine stock is removed.`)) return
    try {
      await this.request(`/products/${id}`, { method: 'DELETE' })
      await this.load()
      this.toast('Product archived.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private openMachineEditor(id?: string) {
    if (!['ADMIN', 'OPERATOR'].includes(this.user?.role || '') || (id && this.user?.role !== 'ADMIN')) return this.toast('Operators can add machines; only administrators can edit existing machines.', 'error')
    const root = document.querySelector<HTMLDivElement>('#modal-root')!
    const machine = id ? this.machines.find(row => row._id === id) : undefined
    if (id && !machine) return this.toast('Machine could not be found. Refresh and try again.', 'error')
    const latitude = machine?.location?.coordinates?.[1] ?? ''
    const longitude = machine?.location?.coordinates?.[0] ?? ''
    const assignedVendor = typeof machine?.vendor === 'object' && machine.vendor ? machine.vendor._id : ''
    const isAdmin = this.user?.role === 'ADMIN'
    const operators = this.adminUsers.filter(account => account.role === 'OPERATOR' && !account.banned)
    root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal-card inventory-modal" role="dialog" aria-modal="true" aria-labelledby="machine-title"><button class="modal-close" data-dismiss aria-label="Close">${icon('close')}</button><div class="eyebrow"><span class="eyebrow-line"></span> LOCATION MANAGEMENT</div><h2 id="machine-title">${machine ? 'Edit machine.' : 'Add a machine.'}</h2><p>Coordinates use decimal degrees; the API uses longitude/latitude map coordinates.${!isAdmin ? ' This machine will be assigned to your operator account.' : ''}</p><form id="machine-form" class="form-stack"><label>Machine name<input name="name" maxlength="100" value="${escapeHtml(machine?.name || '')}" required></label>${machine ? '' : '<label>Machine code<input name="code" pattern="[A-Za-z0-9-]{3,30}" maxlength="30" required></label>'}<label>Street address<input name="address" maxlength="200" value="${escapeHtml(machine?.address || '')}" required></label><label>Description<input name="description" maxlength="500" value="${escapeHtml(machine?.description || '')}"></label><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="${latitude}" required></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="${longitude}" required></label><label>Capacity<input name="capacity" type="number" min="1" max="10000" value="${machine?.capacity || 60}" required></label>${isAdmin ? `<label>Status<select name="status"><option value="ONLINE" ${machine?.status === 'ONLINE' ? 'selected' : ''}>Online</option><option value="OFFLINE" ${machine?.status === 'OFFLINE' ? 'selected' : ''}>Offline</option><option value="MAINTENANCE" ${machine?.status === 'MAINTENANCE' ? 'selected' : ''}>Maintenance</option></select></label><label>Assigned operator<select name="vendorId"><option value="">Unassigned</option>${operators.map(account => `<option value="${account._id}" ${account._id === assignedVendor ? 'selected' : ''}>${escapeHtml(account.name)} · ${escapeHtml(account.email)}</option>`).join('')}</select></label>` : ''}<button class="button-primary form-submit" type="submit">${machine ? 'Save machine' : 'Create machine'} ${icon('check', 16)}</button></form></section></div>`
    root.querySelectorAll<HTMLElement>('[data-dismiss]').forEach(node => node.addEventListener('click', event => { if (event.target === node || node.classList.contains('modal-close')) root.innerHTML = '' }))
    root.querySelector<HTMLFormElement>('#machine-form')?.addEventListener('submit', event => { event.preventDefault(); void this.saveMachine(new FormData(event.currentTarget as HTMLFormElement), machine) })
  }

  private async saveMachine(form: FormData, machine?: Machine) {
    const payload = Object.fromEntries(['name', 'address', 'description', 'latitude', 'longitude', 'capacity', 'status', 'vendorId'].map(key => [key, form.get(key)]))
    if (!machine) payload.code = form.get('code')
    try {
      await this.request(machine ? `/machines/${machine._id}` : '/machines', { method: machine ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      document.querySelector('#modal-root')!.innerHTML = ''
      await this.load()
      this.toast(machine ? 'Machine updated.' : 'Machine created.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async saveInventory(form: FormData, row?: InventoryRow) {
    const payload = {
      machineId: row?.machine._id || String(form.get('machineId') || ''),
      productId: row?.product._id || String(form.get('productId') || ''),
      quantity: Number(form.get('quantity')),
      lowStockThreshold: Number(form.get('lowStockThreshold')),
      slot: String(form.get('slot') || ''),
      expirationDate: String(form.get('expirationDate') || ''),
      discountPercent: Number(form.get('discountPercent') || 0),
    }
    try {
      await this.request('/inventory', { method: 'PUT', body: JSON.stringify(payload) })
      document.querySelector('#modal-root')!.innerHTML = ''
      await this.load()
      this.toast('Inventory saved.', 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async resolveAlert(id: string) {
    try { await this.request(`/alerts/${id}/resolve`, { method: 'PATCH' }); await this.load(); this.toast('Alert marked as resolved.', 'success') } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private async restock(row: InventoryRow, amount: number) {
    const defaultExpiry = row.expirationDate?.slice(0, 10) || ''
    const expirationDate = window.prompt(`Confirm the expiration date for ${row.product.name} stock. This shelf can only track one date.`, defaultExpiry)
    if (expirationDate === null) return
    try { await this.request('/inventory', { method: 'PUT', body: JSON.stringify({ machineId: row.machine._id, productId: row.product._id, quantity: row.quantity + amount, lowStockThreshold: row.lowStockThreshold, expirationDate }) }); await this.load(); this.toast(`${row.product.name} restocked by ${amount}.`, 'success') } catch (error) { this.toast((error as Error).message, 'error') }
  }


  private async toggleMachine(id: string, current: string) {
    if (!this.user || !['ADMIN', 'OPERATOR'].includes(this.user.role)) return this.toast('Operations access is required to change machine status.', 'error')
    const status = current === 'ONLINE' ? 'MAINTENANCE' : 'ONLINE'
    try {
      await this.request(`/machines/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await this.load()
      this.toast(`Machine set to ${status.toLowerCase()}.`, 'success')
    } catch (error) { this.toast((error as Error).message, 'error') }
  }

  private toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const root = document.querySelector<HTMLDivElement>('#toast-root')
    if (!root) return
    const node = document.createElement('div'); node.className = `toast toast-${type}`; node.innerHTML = `${type === 'success' ? icon('check', 16) : icon('spark', 16)}<span>${escapeHtml(message)}</span>`; root.append(node)
    setTimeout(() => node.remove(), 3400)
  }
}

new VendSmartApp()
