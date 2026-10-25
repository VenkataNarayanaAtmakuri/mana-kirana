import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, CircleHelp } from 'lucide-react'
import AuthDialog from './components/AuthDialog.jsx'
import CartPanel from './components/CartPanel.jsx'
import Dashboard from './components/Dashboard.jsx'
import ProductCard from './components/ProductCard.jsx'
import { formatMoney, makeSampleOrders, MINIMUM_ORDER_VALUE, orderChannelLabel, PICKUP_SLOT_MINUTES, readCategories, readOrders, readProducts, STORAGE_KEY } from './data.js'
import {
  archiveLiveCategory,
  archiveLiveProduct,
  createLiveCategory,
  createLiveProduct,
  fetchCustomerMessages,
  fetchLiveCatalog,
  fetchLiveOrders,
  fetchProfile,
  placeLiveOrder,
  setLiveRequestRate,
  subscribeToAccount,
  subscribeToCatalog,
  updateLiveOrderStatus,
  updateLiveProduct,
} from './lib/liveData.js'
import { supabase, supabaseConfigured } from './lib/supabaseClient.js'

function getInitialChannel() {
  const requested = new URLSearchParams(window.location.search).get('mode')
  return requested === 'entrance' ? requested : 'online'
}

function calculateReadyAt(currentOrders) {
  const activeOrders = currentOrders.filter((order) => !order.sample && ['pending', 'preparing'].includes(order.status))
  const now = Date.now()
  const unscheduledOrders = activeOrders.filter((order) => !order.estimatedReadyAt).length
  const latestScheduledTime = activeOrders.reduce((latest, order) => Math.max(latest, Date.parse(order.estimatedReadyAt) || 0), 0)
  const nextAfterQueue = now + (unscheduledOrders + 1) * PICKUP_SLOT_MINUTES * 60_000
  const nextAfterScheduled = latestScheduledTime ? latestScheduledTime + PICKUP_SLOT_MINUTES * 60_000 : 0
  return new Date(Math.max(nextAfterQueue, nextAfterScheduled)).toISOString()
}

function AppHeader({ view, onViewChange, itemCount, pendingCount, authUser, onSignIn, onSignOut }) {
  return (
    <header className="top">
      <div className="wrap top-inner">
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); onViewChange('shop') }} aria-label="Mana Kirana home">
          <span className="mark" lang="te" aria-hidden="true">మ</span>
          <span className="brand-copy">
            <strong>Mana Kirana</strong>
            <small><span lang="te">మన కిరాణా</span> · Venkata Kusuma Haranath General Stores</small>
          </span>
        </a>
        <div className="tabs" role="group" aria-label="Switch view">
          <button className="tab" type="button" aria-pressed={view === 'shop'} onClick={() => onViewChange('shop')}>
            Customer{itemCount > 0 && <span className="count">{itemCount}</span>}
          </button>
          <button className="tab" type="button" aria-pressed={view === 'dashboard'} onClick={() => onViewChange('dashboard')}>
            Shopkeeper{pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </button>
        </div>
        {supabaseConfigured && (authUser
          ? <button className="account-button" type="button" onClick={onSignOut}>Sign out · {authUser.phone?.slice(-4)}</button>
          : <button className="account-button" type="button" onClick={onSignIn}>Sign in</button>)}
      </div>
    </header>
  )
}

function OrderMode({ channel, onChange }) {
  const modes = [
    { id: 'entrance', title: 'Scanned entrance QR', detail: "I'm at the shop door" },
    { id: 'online', title: 'Ordering online', detail: "I'm at home, will come later" },
  ]
  const notes = {
    entrance: 'You scanned the entrance QR. Choose your groceries while you walk in, then collect them from the pickup shelf when they are ready.',
    online: 'Ordering from home. Choose your groceries now, then visit the shop when your pickup is ready.',
  }

  return (
    <div>
      <div className="modes" role="group" aria-label="Choose an ordering mode">
        {modes.map((mode) => (
          <button key={mode.id} className="mode" type="button" aria-pressed={channel === mode.id} onClick={() => onChange(mode.id)}>
            <strong>{mode.title}</strong><span>{mode.detail}</span>
          </button>
        ))}
      </div>
      <p className="mode-note">{notes[channel]}</p>
    </div>
  )
}

function UnlistedItemForm({ onAdd }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('piece')

  function submit(event) {
    event.preventDefault()
    const parsedQuantity = Number(quantity)
    if (!name.trim() || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return
    onAdd({ name: name.trim(), quantity: parsedQuantity, unit })
    setName('')
    setQuantity('1')
    setUnit('piece')
  }

  return (
    <form className="unlisted-form" onSubmit={submit}>
      <div className="unlisted-heading"><div><h2>Request an unlisted item</h2><p>Tell the shopkeeper what you need. No price is added until they confirm it.</p></div><span aria-hidden="true">✎</span></div>
      <div className="unlisted-fields">
        <label><span>Item name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jaggery" required /></label>
        <label><span>Quantity</span><input type="number" min="0.25" step={unit === 'kg' ? '0.25' : '1'} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
        <label><span>Unit</span><select value={unit} onChange={(event) => { setUnit(event.target.value); setQuantity('1') }}><option value="piece">Piece</option><option value="kg">kg</option><option value="pack">Pack</option><option value="litre">Litre</option></select></label>
        <button className="btn" type="submit">Add request</button>
      </div>
    </form>
  )
}

function App() {
  const [view, setView] = useState('shop')
  const [channel, setChannel] = useState(getInitialChannel)
  const [category, setCategory] = useState('All items')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState({})
  const [customItems, setCustomItems] = useState([])
  const [orders, setOrders] = useState(() => supabaseConfigured ? [] : readOrders())
  const [products, setProducts] = useState(() => supabaseConfigured ? [] : readProducts())
  const [customCategories, setCustomCategories] = useState(() => supabaseConfigured ? [] : readCategories())
  const [remoteCategories, setRemoteCategories] = useState([])
  const [customerMessages, setCustomerMessages] = useState([])
  const [authUser, setAuthUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [liveLoading, setLiveLoading] = useState(supabaseConfigured)
  const [liveError, setLiveError] = useState('')
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneConfirm, setPhoneConfirm] = useState('')
  const [payment, setPayment] = useState('pickup')
  const [successOrderId, setSuccessOrderId] = useState('')
  const [successOrderSnapshot, setSuccessOrderSnapshot] = useState(null)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (supabaseConfigured) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, orders, products, categories: customCategories }))
    } catch {
      // The app remains usable if browser storage is unavailable.
    }
  }, [orders, products, customCategories])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user || null
      setAuthUser(nextUser)
      if (!nextUser) {
        setProfile(null)
        setOrders([])
        setCustomerMessages([])
      }
      if (event === 'SIGNED_OUT') setNotice('You are signed out.')
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setLiveError(error.message)
      setAuthUser(data.session?.user || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabaseConfigured || !authUser) {
      setProfile(null)
      setProfileLoading(false)
      return undefined
    }
    let active = true
    setProfileLoading(true)
    fetchProfile(authUser.id).then((nextProfile) => {
      if (active) setProfile(nextProfile)
    }).catch((error) => {
      if (active) setLiveError('Could not load account permissions: ' + error.message)
    }).finally(() => { if (active) setProfileLoading(false) })
    return () => { active = false }
  }, [authUser])

  const refreshLiveCatalog = useCallback(async () => {
    const result = await fetchLiveCatalog()
    setRemoteCategories(result.categories)
    setProducts(result.products)
    setLiveError('')
    return result
  }, [])

  const refreshLiveAccount = useCallback(async () => {
    if (!authUser) return
    const [nextOrders, nextMessages] = await Promise.all([fetchLiveOrders(), fetchCustomerMessages()])
    setOrders(nextOrders)
    setCustomerMessages(nextMessages)
  }, [authUser])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    const loadCatalog = async () => {
      setLiveLoading(true)
      try {
        const result = await fetchLiveCatalog()
        if (active) {
          setRemoteCategories(result.categories)
          setProducts(result.products)
          setLiveError('')
        }
      } catch (error) {
        if (active) setLiveError('Could not load the live catalogue. Check the Supabase URL, key, and migration. ' + error.message)
      } finally {
        if (active) setLiveLoading(false)
      }
    }
    void loadCatalog()
    const unsubscribe = subscribeToCatalog(() => {
      void refreshLiveCatalog().catch((error) => setLiveError('Catalogue update failed: ' + error.message))
    }, (status, error) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeConnected(true)
        setLiveError((current) => current.startsWith('Realtime connection') ? '' : current)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeConnected(false)
        setLiveError('Realtime connection failed. Check the Supabase Realtime publication and access policies.' + (error?.message ? ' ' + error.message : ''))
      }
    })
    return () => { active = false; unsubscribe() }
  }, [refreshLiveCatalog])

  useEffect(() => {
    if (!supabaseConfigured || !authUser) return undefined
    let active = true
    const loadAccount = async () => {
      try {
        const [nextOrders, nextMessages] = await Promise.all([fetchLiveOrders(), fetchCustomerMessages()])
        if (active) {
          setOrders(nextOrders)
          setCustomerMessages(nextMessages)
        }
      } catch (error) {
        if (active) setLiveError('Could not load account updates: ' + error.message)
      }
    }
    void loadAccount()
    const unsubscribe = subscribeToAccount(() => { void loadAccount() }, (status, error) => {
      if (status === 'SUBSCRIBED') setRealtimeConnected(true)
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeConnected(false)
        setLiveError('Realtime account updates failed. Check the Supabase Realtime publication and access policies.' + (error?.message ? ' ' + error.message : ''))
      }
    })
    return () => { active = false; unsubscribe() }
  }, [authUser])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const catalogCategories = useMemo(() => [...new Set(products.map((product) => product.category))], [products])
  const categories = useMemo(() => supabaseConfigured
    ? remoteCategories.map((item) => item.name)
    : [...new Set([...catalogCategories, ...customCategories])], [catalogCategories, customCategories, remoteCategories])
  const cartItems = useMemo(() => products.filter((product) => cart[product.id] > 0).map((product) => ({ ...product, quantity: cart[product.id] })), [cart, products])
  const itemCount = cartItems.length + customItems.length
  const pendingCount = orders.filter((order) => order.status === 'pending').length
  const cartTotal = Math.round(cartItems.reduce((total, item) => total + item.price * item.quantity, 0) * 100) / 100
  const successOrder = successOrderId ? orders.find((order) => order.id === successOrderId) || (successOrderSnapshot?.id === successOrderId ? successOrderSnapshot : null) : null
  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesCategory = category === 'All items' || product.category === category
    const searchText = (product.name + ' ' + product.local + ' ' + product.category).toLowerCase()
    return matchesCategory && searchText.includes(search.trim().toLowerCase())
  }), [category, search, products])

  function changeQuantity(productId, quantity) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    if (quantity > product.stock + 0.001) {
      setNotice('Only ' + product.stock + ' ' + product.unit + ' of ' + product.name + ' are available.')
      const precision = product.unit === 'kg' ? 100 : 1
      quantity = Math.floor((product.stock + 0.000001) * precision) / precision
    }
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0.001) delete next[productId]
      else next[productId] = Math.round(quantity * 100) / 100
      return next
    })
    setSuccessOrderId('')
  }

  function changeFromCart(productId, quantity) {
    const product = products.find((item) => item.id === productId)
    if (product) changeQuantity(productId, quantity)
  }

  async function saveProduct(productId, changes) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    if (supabaseConfigured) {
      try {
        await updateLiveProduct(productId, changes)
        await refreshLiveCatalog()
        setNotice(product.name + ' rate and stock updated for everyone.')
      } catch (error) { setLiveError(error.message); setNotice('Could not save item: ' + error.message) }
      return
    }
    setProducts((current) => current.map((item) => item.id === productId ? { ...item, ...changes } : item))
    if (changes.stock < (cart[productId] || 0)) {
      const precision = product.unit === 'kg' ? 100 : 1
      const safeQuantity = Math.floor((changes.stock + 0.000001) * precision) / precision
      setCart((current) => {
        const next = { ...current }
        if (safeQuantity <= 0) delete next[productId]
        else next[productId] = safeQuantity
        return next
      })
      setNotice('Stock updated. The basket was adjusted to the available quantity.')
    } else {
      setNotice(product.name + ' rate and stock updated.')
    }
  }

  async function addProduct(details) {
    if (supabaseConfigured) {
      try {
        const categoryRow = remoteCategories.find((item) => item.name === details.category)
        if (!categoryRow) throw new Error('Choose an active category.')
        await createLiveProduct(details, categoryRow.id)
        await refreshLiveCatalog()
        setCategory('All items')
        setSearch('')
        setNotice(details.name + ' added to the shared catalogue.')
        return true
      } catch (error) { setLiveError(error.message); setNotice('Could not add item: ' + error.message); return false }
    }
    const baseId = details.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
    const id = baseId + '-' + Date.now().toString().slice(-5)
    const emoji = details.category.toLowerCase().includes('dairy') ? '🥛' : details.category.toLowerCase().includes('fresh') ? '🥬' : details.category.toLowerCase().includes('snack') ? '🥨' : '🛍️'
    const product = { ...details, id, step: details.unit === 'kg' ? 0.25 : 1, emoji, tint: 'new', note: 'Added by the shopkeeper' }
    setProducts((current) => [...current, product])
    setCategory('All items')
    setSearch('')
    setNotice(product.name + ' added to the customer catalogue.')
    return true
  }

  async function addCategory(value) {
    const name = value.trim()
    if (!name) return false
    if (categories.some((categoryName) => categoryName.toLowerCase() === name.toLowerCase())) {
      setNotice(name + ' category already exists.')
      return false
    }
    if (supabaseConfigured) {
      try {
        await createLiveCategory(name)
        await refreshLiveCatalog()
      } catch (error) { setLiveError(error.message); setNotice('Could not add category: ' + error.message); return false }
    } else setCustomCategories((current) => [...current, name])
    setNotice(name + ' category added. It is ready to use for products.')
    return true
  }

  async function removeCategory(name) {
    if (supabaseConfigured) {
      try {
        const categoryRow = remoteCategories.find((item) => item.name === name)
        if (!categoryRow) return
        const result = await archiveLiveCategory(categoryRow.id)
        await refreshLiveCatalog()
        setCategory((current) => current === name ? 'All items' : current)
        setNotice(result.moved_products
          ? `${name} removed. ${result.moved_products} catalogue item${result.moved_products === 1 ? '' : 's'} moved to ${result.fallback}.`
          : `${name} category removed.`)
      } catch (error) { setLiveError(error.message); setNotice('Could not remove category: ' + error.message) }
      return
    }
    const matchingProducts = products.filter((product) => product.category === name)
    const replacement = name.toLowerCase() === 'other' ? 'Uncategorized' : 'Other'
    const fallback = categories.find((categoryName) => categoryName.toLowerCase() === replacement.toLowerCase()) || replacement
    setProducts((current) => current.map((product) => product.category === name ? { ...product, category: fallback } : product))
    setCustomCategories((current) => {
      const withoutRemoved = current.filter((categoryName) => categoryName.toLowerCase() !== name.toLowerCase())
      if (matchingProducts.length && !categories.some((categoryName) => categoryName.toLowerCase() === fallback.toLowerCase())) return [...withoutRemoved, fallback]
      return withoutRemoved
    })
    setCategory((current) => current === name ? 'All items' : current)
    setNotice(matchingProducts.length
      ? `${name} removed. ${matchingProducts.length} catalogue ${matchingProducts.length === 1 ? 'item was' : 'items were'} moved to ${fallback}.`
      : `${name} category removed.`)
  }

  function addCustomItem(item) {
    setCustomItems((current) => [...current, { ...item, id: 'request-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) }])
    setPayment('pickup')
    setSuccessOrderId('')
    setNotice('Request added. The shopkeeper will set its rate at the shop.')
  }

  function removeCustomItem(id) {
    setCustomItems((current) => current.filter((item) => item.id !== id))
  }

  async function removeProduct(productId) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    if (supabaseConfigured) {
      try {
        await archiveLiveProduct(productId)
        await refreshLiveCatalog()
        setCart((current) => { const next = { ...current }; delete next[productId]; return next })
        setNotice(product.name + ' removed from the shared catalogue.')
      } catch (error) { setLiveError(error.message); setNotice('Could not remove item: ' + error.message) }
      return
    }
    setProducts((current) => current.filter((item) => item.id !== productId))
    setCart((current) => {
      const next = { ...current }
      delete next[productId]
      return next
    })
    setNotice(product.name + ' removed from the customer catalogue.')
  }

  function selectChannel(next) {
    setChannel(next)
    setSuccessOrderId('')
    const url = new URL(window.location.href)
    if (next === 'online') url.searchParams.delete('mode')
    else url.searchParams.set('mode', next)
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }

  async function submitOrder(event) {
    event.preventDefault()
    if (!cartItems.length && !customItems.length) return
    if (cartTotal <= MINIMUM_ORDER_VALUE) {
      setNotice('The confirmed item subtotal must be more than ₹200. Unpriced requests do not count toward the minimum.')
      return
    }
    const digits = phone.replace(/\D/g, '')
    const confirmedDigits = phoneConfirm.replace(/\D/g, '')
    if (digits.length !== 10 || confirmedDigits.length !== 10) {
      setNotice('Enter the 10-digit mobile number in both fields to confirm your order.')
      return
    }
    if (digits !== confirmedDigits) {
      setNotice('The mobile numbers do not match. Re-enter the same number to confirm your order.')
      return
    }
    if (supabaseConfigured) {
      if (!authUser) {
        setShowAuthDialog(true)
        setNotice('Sign in with your mobile number to confirm and submit this order.')
        return
      }
      const accountDigits = (authUser.phone || '').replace(/\D/g, '').slice(-10)
      if (accountDigits !== digits) {
        setNotice('Enter the mobile number linked to the signed-in, verified account.')
        return
      }
      try {
        const result = await placeLiveOrder({
          name: customerName.trim(),
          phone: digits,
          channel,
          payment: customItems.length ? 'pickup' : payment === 'upi' ? 'upi_demo' : 'pickup',
          items: [
            ...cartItems.map((item) => ({ product_id: item.id, name: item.name, emoji: item.emoji, quantity: item.quantity, unit: item.unit, price: item.price, line_total: Math.round(item.price * item.quantity * 100) / 100, custom: false, price_confirmed: true })),
            ...customItems.map((item) => ({ product_id: null, name: item.name, emoji: '📝', quantity: item.quantity, unit: item.unit, price: null, line_total: null, custom: true, price_confirmed: false })),
          ],
        })
        const id = 'MK-' + String(result.order_number).padStart(6, '0')
        setSuccessOrderSnapshot({ id, estimatedReadyAt: result.estimated_ready_at, status: 'pending' })
        setCart({})
        setCustomItems([])
        setSuccessOrderId(id)
        setMobileCartOpen(false)
        await Promise.all([refreshLiveCatalog(), refreshLiveAccount()])
        setNotice('Order ' + id + ' placed. Your account will show preparation updates.')
      } catch (error) {
        setLiveError(error.message)
        setNotice('Order not placed: ' + error.message)
      }
      return
    }
    const id = 'MK-' + String(Date.now()).slice(-6)
    const order = {
      id,
      name: customerName.trim(),
      phone: digits.slice(0, 5) + ' ' + digits.slice(5),
      channel,
      status: 'pending',
      payment: customItems.length ? 'Pay at pickup · requested prices pending' : payment === 'upi' ? 'UPI · demo only' : 'Pay at pickup · demo',
      total: cartTotal,
      estimatedReadyAt: calculateReadyAt(orders),
      createdAt: new Date().toISOString(),
      sample: false,
      stockDeducted: cartItems.length > 0,
      items: [...cartItems.map((item) => ({
        productId: item.id,
        name: item.name,
        emoji: item.emoji,
        quantity: item.quantity,
        unit: item.unit,
        price: item.price,
        lineTotal: Math.round(item.price * item.quantity * 100) / 100,
        custom: false,
      })), ...customItems.map((item) => ({
        productId: item.id,
        name: item.name,
        emoji: '📝',
        quantity: item.quantity,
        unit: item.unit,
        price: null,
        lineTotal: null,
        custom: true,
        priced: false,
      }))],
    }
    setProducts((current) => current.map((product) => {
      const orderedItem = order.items.find((item) => item.productId === product.id)
      return orderedItem ? { ...product, stock: Math.max(0, Math.round((product.stock - orderedItem.quantity) * 100) / 100) } : product
    }))
    setOrders((current) => [order, ...current])
    setCart({})
    setCustomItems([])
    setSuccessOrderId(id)
    setMobileCartOpen(false)
    setNotice('Order ' + id + ' sent to ' + orderChannelLabel(channel).toLowerCase() + '.')
  }

  async function updateOrder(id, status) {
    if (supabaseConfigured) {
      const existingOrder = orders.find((order) => order.id === id)
      try {
        await updateLiveOrderStatus(existingOrder?.dbId, status)
        await Promise.all([refreshLiveAccount(), status === 'rejected' ? refreshLiveCatalog() : Promise.resolve()])
        setNotice(status === 'rejected' ? 'Order declined.' : 'Order updated to ' + (status === 'preparing' ? 'Preparing' : status === 'ready' ? 'Ready for pickup' : 'Collected') + '.')
      } catch (error) { setLiveError(error.message); setNotice('Could not update order: ' + error.message) }
      return
    }
    const existingOrder = orders.find((order) => order.id === id)
    if (status === 'rejected' && existingOrder?.stockDeducted && !existingOrder.stockRestored) {
      setProducts((current) => current.map((product) => {
        const returnedItem = existingOrder.items.find((item) => item.productId === product.id)
        return returnedItem ? { ...product, stock: Math.round((product.stock + returnedItem.quantity) * 100) / 100 } : product
      }))
    }
    setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order))
    setNotice(status === 'rejected' ? 'Order declined.' : 'Order updated to ' + (status === 'preparing' ? 'Preparing' : status === 'ready' ? 'Ready for pickup' : 'Collected') + '.')
  }

  async function setRequestedItemRate(orderId, itemId, rate) {
    const parsedRate = Number(rate)
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) return
    if (supabaseConfigured) {
      try {
        await setLiveRequestRate(itemId, parsedRate)
        await refreshLiveAccount()
        setNotice('Requested item rate added. The customer account shows the updated total.')
      } catch (error) { setLiveError(error.message); setNotice('Could not set rate: ' + error.message) }
      return
    }
    setOrders((current) => current.map((order) => {
      if (order.id !== orderId) return order
      const items = order.items.map((item) => {
        if (item.productId !== itemId || !item.custom || item.priced) return item
        return { ...item, price: parsedRate, lineTotal: Math.round(parsedRate * item.quantity * 100) / 100, priced: true }
      })
      const total = items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0)
      return { ...order, items, total }
    }))
    setNotice('Requested item rate added to the order total.')
  }

  function resetSamples() {
    if (supabaseConfigured) return
    setOrders(makeSampleOrders())
    setNotice('Demo orders restored.')
  }

  function cartPanelProps() {
    return {
      items: cartItems,
      customItems,
      total: cartTotal,
      onChange: changeFromCart,
      onClear: () => { setCart({}); setCustomItems([]); setSuccessOrderId('') },
      onRemoveCustomItem: removeCustomItem,
      customerName,
      onNameChange: setCustomerName,
      phone,
      onPhoneChange: setPhone,
      phoneConfirm,
      onPhoneConfirmChange: setPhoneConfirm,
      payment,
      onPaymentChange: setPayment,
      onSubmit: submitOrder,
      channelLabel: orderChannelLabel(channel),
      successOrderId,
      successOrder,
      minimumOrderValue: MINIMUM_ORDER_VALUE,
      liveMode: supabaseConfigured,
    }
  }

  return (
    <div className="app-shell min-h-screen" id="top">
      <AppHeader view={view} onViewChange={setView} itemCount={itemCount} pendingCount={pendingCount} authUser={authUser} onSignIn={() => setShowAuthDialog(true)} onSignOut={() => { void supabase.auth.signOut() }} />
      {notice && <div className="toast" role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
      <main className="wrap">
        {supabaseConfigured ? <p className="note live-note"><strong>Shared live mode.</strong> Catalogue, stock, orders, queue times, and account updates use Supabase{realtimeConnected ? ' · live sync connected' : ' · connecting to live sync'}. Payments remain demos; phone sign-in requires an SMS provider.</p> : <p className="note"><strong>Prototype with sample data.</strong> Orders and catalogue changes stay in this browser only. Payments are demos; order updates appear in this app, but no account message is sent.</p>}
        {liveError && <p className="live-error" role="alert">{liveError}</p>}
        {view === 'dashboard' ? (
          !supabaseConfigured || profile?.role === 'shopkeeper'
            ? <Dashboard orders={orders} products={products} categories={categories} onAddCategory={addCategory} onRemoveCategory={removeCategory} onUpdateOrder={updateOrder} onSetRequestedItemRate={setRequestedItemRate} onResetSamples={resetSamples} onSaveProduct={saveProduct} onAddProduct={addProduct} onRemoveProduct={removeProduct} liveMode={supabaseConfigured} realtimeConnected={realtimeConnected} shopkeeperName={profile?.full_name || (supabaseConfigured ? 'Shopkeeper' : 'Ramesh')} />
            : <section className="access-gate"><h1>Shopkeeper sign-in</h1><p>{profileLoading ? 'Checking this account…' : authUser ? 'This account is registered as a customer. Ask the project owner to grant shopkeeper access, then sign in again.' : 'Sign in with the shopkeeper’s verified phone account to manage orders, stock, rates, and categories.'}</p>{!profileLoading && (authUser ? <button className="btn" type="button" onClick={() => { void supabase.auth.signOut() }}>Sign out</button> : <button className="btn primary" type="button" onClick={() => setShowAuthDialog(true)}>Sign in</button>)}</section>
        ) : (
          <section className="view customer-page" aria-label="Customer ordering">
            <div className="page-heading">
              <h1>Order from Venkata Kusuma Haranath General Stores</h1>
              <p className="muted">No app to install. Choose online pre-order or entrance QR ordering.</p>
            </div>
            {supabaseConfigured && authUser && customerMessages.length > 0 && <section className="account-messages" aria-label="Order updates"><div><h2>Your order updates</h2><span>Live messages for this account</span></div><ul>{customerMessages.slice(0, 4).map((message) => <li key={message.id}><span>{message.body}</span><time>{new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(message.created_at))}</time></li>)}</ul></section>}
            <div className="order-rules-notice"><strong>Minimum confirmed order: more than ₹200.</strong> Items waiting for a shopkeeper’s price do not count toward this minimum. Orders are scheduled in 15-minute pickup slots based on the queue.</div>
            <div className="custom-request-notice"><strong>Can’t find an item?</strong> Add a request by name and quantity. Its price is not included in the confirmed subtotal; the shopkeeper will set the rate, and you can settle that amount at the shop desk.</div>
            <OrderMode channel={channel} onChange={selectChannel} />
            {supabaseConfigured && !authUser && <p className="account-prompt"><strong>Want to place an order?</strong> Sign in with your verified mobile number, then re-enter that same number at checkout for confirmation. <button type="button" onClick={() => setShowAuthDialog(true)}>Sign in</button></p>}
            {liveLoading && products.length === 0 ? <div className="empty-results"><strong>Loading the shared catalogue…</strong></div> : <div className="shop-layout" id="shop-products">
              <section className="catalog-section" aria-label="Products">
                <div className="catalog-toolbar">
                  <div className="search-control">
                    <label htmlFor="product-search">Search the shop</label>
                    <input id="product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try rice, dal, onion or పాలు" />
                  </div>
                  <div className="category-list" role="group" aria-label="Product categories">
                    {['All items', ...catalogCategories].map((item) => (
                      <button key={item} type="button" className="chip" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>
                    ))}
                  </div>
                </div>
                <p className="results-label">{category === 'All items' ? 'Everyday essentials' : category}<span> · {visibleProducts.length} items</span></p>
                {visibleProducts.length ? (
                  <ul className="product-list">{visibleProducts.map((product) => (
                    <ProductCard key={product.id} product={product} quantity={cart[product.id] || 0} onChange={(quantity) => changeQuantity(product.id, quantity)} />
                  ))}</ul>
                ) : (
                  <div className="empty-results"><strong>Nothing matches that search.</strong><span>Try another word or pick a category.</span></div>
                )}
                <UnlistedItemForm onAdd={addCustomItem} />
              </section>
              <aside className="desktop-cart"><CartPanel {...cartPanelProps()} /></aside>
            </div>}
          </section>
        )}
      </main>

      {view === 'shop' && itemCount > 0 && (
        <button className="mobile-cart-bar" type="button" onClick={() => setMobileCartOpen(true)}>
          <span>{itemCount} {itemCount === 1 ? 'item' : 'items'} · {customItems.length ? formatMoney(cartTotal) + ' confirmed + price pending' : formatMoney(cartTotal)}</span><strong>View bill <ArrowRight size={16} /></strong>
        </button>
      )}
      {mobileCartOpen && (
        <div className="mobile-cart-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setMobileCartOpen(false) }}>
          <div className="mobile-cart-drawer">
            <div className="drawer-handle" /><button className="drawer-close" type="button" onClick={() => setMobileCartOpen(false)} aria-label="Close bill">×</button>
            <CartPanel {...cartPanelProps()} />
          </div>
        </div>
      )}
      <button className="help-button" type="button" onClick={() => setNotice('For this prototype, all orders are for pickup at Sri Lakshmi Kirana Stores.')}><CircleHelp size={16} /><span>Need help?</span></button>
      {showAuthDialog && <AuthDialog onClose={() => setShowAuthDialog(false)} />}
    </div>
  )
}

export default App
