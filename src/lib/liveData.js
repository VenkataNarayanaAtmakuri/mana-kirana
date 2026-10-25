import { supabase } from './supabaseClient.js'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

function orderLabel(orderNumber) {
  return 'MK-' + String(orderNumber).padStart(6, '0')
}

export async function fetchLiveCatalog() {
  const [categories, rows] = await Promise.all([
    supabase.from('categories').select('id,name').eq('active', true).order('name').then(unwrap),
    supabase.from('products').select('*,categories(id,name)').eq('active', true).order('name').then(unwrap),
  ])
  return {
    categories,
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      local: row.local || '',
      category: row.categories?.name || 'Other',
      categoryId: row.category_id,
      price: Number(row.price),
      unit: row.unit,
      step: Number(row.step) || 1,
      stock: Number(row.stock),
      emoji: row.emoji || '🛍️',
      tint: row.tint || 'new',
      note: row.note || '',
    })),
  }
}

export async function fetchLiveOrders() {
  const rows = unwrap(await supabase.from('orders').select('*,order_items(*)').order('created_at', { ascending: false }))
  return rows.map((row) => ({
    id: orderLabel(row.order_number),
    dbId: row.id,
    name: row.customer_name,
    phone: row.customer_phone ? '••••• ' + row.customer_phone.replace(/\D/g, '').slice(-4) : '',
    channel: row.channel,
    status: row.status,
    payment: row.payment_method === 'upi_demo' ? 'UPI · demo only' : 'Pay at pickup',
    total: Number(row.total),
    createdAt: row.created_at,
    estimatedReadyAt: row.estimated_ready_at,
    sample: false,
    stockDeducted: true,
    items: (row.order_items || []).map((item) => ({
      id: item.id,
      productId: item.product_id || item.id,
      name: item.item_name,
      emoji: item.emoji || (item.custom_request ? '📝' : '🛍️'),
      quantity: Number(item.quantity),
      unit: item.unit,
      price: item.price == null ? null : Number(item.price),
      lineTotal: item.line_total == null ? null : Number(item.line_total),
      custom: item.custom_request,
      priced: item.price_confirmed,
    })),
  }))
}

export async function fetchCustomerMessages() {
  return unwrap(await supabase.from('customer_messages').select('id,body,created_at,order_id').order('created_at', { ascending: false }).limit(25))
}

export async function fetchProfile(userId) {
  return unwrap(await supabase.from('profiles').select('role,full_name').eq('id', userId).single())
}

export async function createLiveCategory(name) {
  return unwrap(await supabase.from('categories').insert({ name }).select('id,name').single())
}

export async function archiveLiveCategory(categoryId) {
  return unwrap(await supabase.rpc('remove_category', { p_category_id: categoryId }))
}

export async function createLiveProduct(details, categoryId) {
  return unwrap(await supabase.from('products').insert({
    name: details.name,
    local: details.local,
    category_id: categoryId,
    unit: details.unit,
    price: details.price,
    stock: details.stock,
    step: details.unit === 'kg' ? 0.01 : 1,
    emoji: details.category.toLowerCase().includes('dairy') ? '🥛' : details.category.toLowerCase().includes('fresh') ? '🥬' : details.category.toLowerCase().includes('snack') ? '🥨' : '🛍️',
    tint: 'new',
    note: 'Added by the shopkeeper',
  }).select('id').single())
}

export async function updateLiveProduct(productId, changes) {
  return unwrap(await supabase.from('products').update({ price: changes.price, stock: changes.stock }).eq('id', productId).select('id').single())
}

export async function archiveLiveProduct(productId) {
  return unwrap(await supabase.from('products').update({ active: false }).eq('id', productId).select('id').single())
}

export async function placeLiveOrder(details) {
  return unwrap(await supabase.rpc('place_order', {
    p_customer_name: details.name,
    p_confirmed_phone: details.phone,
    p_channel: details.channel,
    p_payment_method: details.payment,
    p_items: details.items,
  }))
}

export async function updateLiveOrderStatus(orderId, nextStatus) {
  return unwrap(await supabase.rpc('update_order_status', { p_order_id: orderId, p_next_status: nextStatus }))
}

export async function setLiveRequestRate(orderItemId, rate) {
  return unwrap(await supabase.rpc('set_requested_item_price', { p_order_item_id: orderItemId, p_rate: rate }))
}

export function subscribeToCatalog(onChange, onStatus) {
  const channel = supabase.channel('mana-kirana-catalog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
    .subscribe((status, error) => onStatus?.(status, error))
  return () => { void supabase.removeChannel(channel) }
}

export function subscribeToAccount(onChange, onStatus) {
  const channel = supabase.channel('mana-kirana-account')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_messages' }, onChange)
    .subscribe((status, error) => onStatus?.(status, error))
  return () => { void supabase.removeChannel(channel) }
}
