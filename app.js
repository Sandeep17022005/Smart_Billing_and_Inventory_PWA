/* ═══════════════════════════════════════
   SRINIVASA STORE — APPLICATION LOGIC
   Handles billing, ledger, local backups, and two-directional Google Sheets sync.
   ═══════════════════════════════════════ */

/* ═══════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════ */
const SHEETS_URL_KEY = 'srini_sheets_url';
let SHEETS_URL = localStorage.getItem(SHEETS_URL_KEY) || 'YOUR_URL_HERE';

const ITEMS_CONFIG = [
  {id:'onion',    emoji:'🧅', name:'Onion',        price:40},
  {id:'potato',   emoji:'🥔', name:'Potato',       price:30},
  {id:'tamarind', emoji:'🫙', name:'Tamarind',     price:120},
  {id:'chilli',   emoji:'🌶️', name:'Chilli',       price:80},
  {id:'garlic_n', emoji:'🧄', name:'Garlic Normal',price:60},
  {id:'garlic_l', emoji:'🧄', name:'Garlic Loose', price:50},
  {id:'ginger',   emoji:'🫚', name:'Ginger',       price:70},
  {id:'turmeric', emoji:'🟡', name:'Turmeric',     price:90},
  {id:'others',   emoji:'📦', name:'Others',       price:0,  othersOnly:true},
  {id:'old_balance', emoji:'📜', name:'Old Balance', price:0, othersOnly:true},
];

/* ═══════════════════════════════════════
   STATE
   ═══════════════════════════════════════ */
let records   = JSON.parse(localStorage.getItem('srini_records')   || '[]');
let customers = JSON.parse(localStorage.getItem('srini_customers') || '[]');

let addState = {step:1, custName:'', custPhone:'', custId:null, selectedItems:{}, payStatus:'unpaid', partialAmt:0, existingCustomer:false};
let viewingBillId = null;

/* ═══════════════════════════════════════
   CUSTOMER ID
   ═══════════════════════════════════════ */
let nextCustIdNum = parseInt(localStorage.getItem('srini_next_cust_id')||'1', 10);
function genCustId(){
  const id = 'C'+String(nextCustIdNum).padStart(4,'0');
  nextCustIdNum++;
  localStorage.setItem('srini_next_cust_id', String(nextCustIdNum));
  return id;
}

/* ═══════════════════════════════════════
   PERSISTENCE
   ═══════════════════════════════════════ */
function save(){
  localStorage.setItem('srini_records',   JSON.stringify(records));
  localStorage.setItem('srini_customers', JSON.stringify(customers));
}
function saveCustomer(name, phone){
  let existing = customers.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing){
    if(!existing.id) existing.id = genCustId();
    if(phone) existing.phone = phone;
    existing.lastUsed = Date.now();
    customers.sort((a,b)=>b.lastUsed-a.lastUsed);
    save();
    return existing.id;
  } else {
    const id = genCustId();
    customers.unshift({id, name, phone:phone||'', lastUsed:Date.now()});
    customers.sort((a,b)=>b.lastUsed-a.lastUsed);
    save();
    return id;
  }
}

// One-time migration: backfill IDs for customers/bills saved before the ID system existed
(function migrateCustIds(){
  let changed = false;
  customers.forEach(c=>{ if(!c.id){ c.id = genCustId(); changed = true; } });
  records.forEach(r=>{
    if(!r.custId){
      const cust = customers.find(c=>c.name.toLowerCase()===(r.custName||'').toLowerCase());
      r.custId = cust ? cust.id : genCustId();
      changed = true;
    }
  });
  if(changed) save();
})();

/* ═══════════════════════════════════════
   TOAST
   ═══════════════════════════════════════ */
let toastTimer;
function toast(msg, type=''){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.className='', 2800);
}

/* ═══════════════════════════════════════
   SUMMARY
   ═══════════════════════════════════════ */
function updateSummary(){
  const total  = records.length;
  const rev    = records.reduce((s,r)=>s+r.total,0);
  const unpaid = records.reduce((s,r)=>s+(r.total - (r.paidAmount||0)),0);
  setTxt('sum-count', total);
  setTxt('sum-revenue', '₹'+fmtAmt(rev));
  setTxt('sum-unpaid', '₹'+fmtAmt(unpaid));
}

/* ═══════════════════════════════════════
   FORMAT HELPERS
   ═══════════════════════════════════════ */
function fmtAmt(n){return Number(n).toLocaleString('en-IN');}
function fmtDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
function fmtTime(ts){
  return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
}
function billStatus(r){
  const paid = r.paidAmount || 0;
  if(paid === 0 && r.payStatus === 'unpaid') return 'unpaid';
  if(paid >= r.total) return 'paid';
  if(paid > 0) return 'partial';
  return r.payStatus || 'unpaid';
}
function billStatusFromPaid(paid, total) {
  if (paid === 0) return 'unpaid';
  if (paid >= total) return 'paid';
  return 'partial';
}

/* ═══════════════════════════════════════
   RECORDS LIST
   ═══════════════════════════════════════ */
function renderList(){
  const container = document.getElementById('records-container');
  if(!container) return;

  // Filter by search
  let filtered = records;
  if(searchQuery){
    const q = searchQuery.toLowerCase();
    filtered = records.filter(r=>
      String(r.billNo).toLowerCase().includes(q) ||
      r.custName.toLowerCase().includes(q) ||
      (r.custPhone && r.custPhone.includes(q))
    );
  }

  if(!filtered.length){
    container.innerHTML = records.length
      ? `<div class="empty-state"><div class="es-icon">🔍</div><div class="es-text">${t('noResults')}</div><div class="es-sub">${t('noResultsSub')}</div></div>`
      : `<div class="empty-state"><div class="es-icon">📋</div><div class="es-text">${t('emptyText')}</div><div class="es-sub">${t('emptySub')}</div></div>`;
    updateSummary(); return;
  }

  // Group by date
  const groups = {};
  filtered.forEach(r=>{
    const key = fmtDate(r.ts);
    if(!groups[key]) groups[key]=[];
    groups[key].push(r);
  });

  let html = '';
  Object.entries(groups).forEach(([date,bills])=>{
    html += `<div class="date-group"><div class="date-label">${date}</div>`;
    bills.forEach(r=>{
      const st = billStatus(r);
      const paid = r.paidAmount || 0;
      const due  = r.total - paid;
      html += `<div class="bill-card ${st}" onclick="viewBill('${r.id}')">
        <div class="bill-top">
          <div><div class="bill-name">${r.custName}</div><div class="bill-phone">${r.custPhone||'No phone'} ${r.custId?'· '+r.custId:''}</div></div>
          <div class="bill-amount">₹${fmtAmt(r.total)}</div>
        </div>
        <div class="bill-meta">
          <div class="bill-items">${r.itemSummary}</div>
          <span class="badge ${st}">${st==='partial'?t('partial'):st==='paid'?t('paid'):t('unpaid')}</span>
        </div>
        ${st==='partial'?`<div class="bill-time" style="color:var(--gold);font-size:11px;">${t('paidInfo')} ₹${fmtAmt(paid)} · ${t('dueInfo')} ₹${fmtAmt(due)}</div>`:''}
        <div class="bill-time">${fmtTime(r.ts)} · Bill #${r.billNo}</div>
      </div>`;
    });
    html += '</div>';
  });
  container.innerHTML = html;
  updateSummary();
}

/* ═══════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════ */
let searchQuery = '';
function onSearch(){
  const val = document.getElementById('search-input').value;
  searchQuery = val ? val.trim() : '';
  document.getElementById('search-clear').style.display = searchQuery ? 'block' : 'none';
  renderList();
}
function clearSearch(){
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  renderList();
}

/* ═══════════════════════════════════════
   BALANCE BILL
   ═══════════════════════════════════════ */
function sendBalanceBill(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;
  const due = r.total - (r.paidAmount||0);
  if(due<=0){ toast(t('toastNoBal'),'error'); return; }

  // Calculate total outstanding across ALL bills for this customer
  const custBills = records.filter(x=>x.custName===r.custName);
  const totalDueAll = custBills.reduce((s,x)=>s+(x.total-(x.paidAmount||0)),0);
  const dueBillsCount = custBills.filter(x=>(x.total-(x.paidAmount||0))>0).length;

  let totalBalSection = '';
  if(dueBillsCount > 1){
    totalBalSection = `\n\n📊 *${t('totalOutstandingLabel')}*\n(${dueBillsCount} pending bills)\n*${t('waBalDue')}: ₹${fmtAmt(totalDueAll)}*`;
  }

  const balanceMsg = `*${t('storeName')}* — ${t('receiptAddr')}\n\n${t('waDear')} *${r.custName}*,\n${t('waBalReminder')}\n\nBill #${r.billNo} | ${fmtDate(r.ts)}\n*${t('waTotal')}: ₹${fmtAmt(r.total)}*\n${t('waPaid')}: ₹${fmtAmt(r.paidAmount||0)}\n⚠️ ${t('waBalDue')} (this bill): ₹${fmtAmt(due)}${totalBalSection}\n\n${t('waKindly')}`;

  if(r.custPhone && r.custPhone.length>=10){
    const waUrl = `https://wa.me/91${r.custPhone}?text=${encodeURIComponent(balanceMsg)}`;
    window.open(waUrl,'_blank');
    toast(t('toastOpenWA'),'success');
  } else {
    if(navigator.clipboard){
      navigator.clipboard.writeText(balanceMsg).then(()=>toast(t('toastBalCopied'),'success'));
    } else {
      toast(t('toastNoPhone'),'error');
    }
  }
}

function sendTotalBalance(custId){
  const custBills = records.filter(x=>x.custId===custId);
  const totalBilled = custBills.reduce((s,r)=>s+r.total,0);
  const totalPaid   = custBills.reduce((s,r)=>s+(r.paidAmount||0),0);
  const totalDue    = totalBilled - totalPaid;
  if(totalDue<=0){ toast(t('toastNoBal'),'error'); return; }

  const cust = customers.find(c=>c.id===custId)||{};
  const custName = cust.name || (custBills[0]&&custBills[0].custName) || '';
  const dueBills = custBills.filter(r=>(r.total-(r.paidAmount||0))>0).sort((a,b)=>a.ts-b.ts);
  const billLines = dueBills.map(r=>`  • Bill #${r.billNo} (${fmtDate(r.ts)}): ₹${fmtAmt(r.total-(r.paidAmount||0))} due`).join('\n');

  const msg = `*${t('storeName')}* — ${t('receiptAddr')}\n\n${t('waDear')} *${custName}*,\n${t('waBalReminder')}\n\n📊 *${t('totalOutstandingLabel')}*\n\n${billLines}\n\n*${t('waBalDue')}: ₹${fmtAmt(totalDue)}*\n\n${t('waKindly')}`;

  const phone = cust.phone || (dueBills[0]&&dueBills[0].custPhone) || '';
  if(phone && phone.length>=10){
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`,'_blank');
    toast(t('toastOpenWA'),'success');
  } else {
    if(navigator.clipboard){
      navigator.clipboard.writeText(msg).then(()=>toast(t('toastBalCopied'),'success'));
    } else {
      toast(t('toastNoPhone'),'error');
    }
  }
}

function openSheet(id){
  document.getElementById('overlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}
function closeSheet(id){
  document.getElementById(id).classList.remove('open');
}
function closeAllSheets(){
  document.querySelectorAll('.sheet.open').forEach(s=>s.classList.remove('open'));
  document.getElementById('overlay').classList.remove('open');
}

/* ═══════════════════════════════════════
   ADD BILL
   ═══════════════════════════════════════ */
function openAddBill(){
  addState = {step:1, custName:'', custPhone:'', custId:null, selectedItems:{}, payStatus:'unpaid', partialAmt:0, existingCustomer:false};
  document.getElementById('inp-name').value  = '';
  document.getElementById('inp-phone').value = '';
  document.getElementById('phone-field').style.display = 'block';
  document.getElementById('step-1').style.display  = 'block';
  document.getElementById('step-2').style.display  = 'none';
  document.getElementById('step-1-bar').classList.add('active');
  document.getElementById('step-2-bar').classList.remove('active');
  renderQuickCustomers();
  openSheet('sheet-add');
}
function closeAddBill(){
  closeSheet('sheet-add');
  if(!document.querySelector('.sheet.open')) document.getElementById('overlay').classList.remove('open');
}

function openAddBillForCustomer(custId){
  const cust = customers.find(c=>c.id===custId);
  if(!cust){ toast('Customer not found','error'); return; }

  addState = {step:2, custName:cust.name, custPhone:cust.phone||'', custId:cust.id, selectedItems:{}, payStatus:'unpaid', partialAmt:0, existingCustomer:true};

  document.getElementById('inp-name').value  = cust.name;
  document.getElementById('inp-phone').value = cust.phone||'';
  document.getElementById('inp-name').classList.add('filled');
  document.getElementById('phone-field').style.display = 'block';

  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'block';
  document.getElementById('step-1-bar').classList.add('active');
  document.getElementById('step-2-bar').classList.add('active');

  closeAllSheets();
  renderItemGrid();
  setPayStatus('unpaid');
  openSheet('sheet-add');
}

function renderQuickCustomers(){
  const el = document.getElementById('quick-customers');
  if(!el) return;
  const recent = customers.slice(0,10);
  if(!recent.length){ el.innerHTML=`<span class="text-muted">${t('noCustomers')}</span>`; return; }
  el.innerHTML = recent.map(c=>`<div class="quick-pill" onclick="selectQuickCustomer('${c.id}','${escHtml(c.name)}','${c.phone||''}')">${c.name}</div>`).join('');
}
function selectQuickCustomer(id, name, phone){
  addState.custId = id;
  addState.custName = name;
  addState.custPhone = phone;
  addState.existingCustomer = true;
  document.getElementById('inp-name').value  = name;
  document.getElementById('inp-name').classList.add('filled');
  document.getElementById('inp-phone').value = phone;
  document.getElementById('phone-field').style.display = 'block';
  document.querySelectorAll('.quick-pill').forEach(p=>p.classList.remove('selected'));
  if (event && event.target) {
    event.target.classList.add('selected');
  }
  document.getElementById('ac-dropdown').classList.remove('show');
}

function onNameInput(){
  const val = document.getElementById('inp-name').value.toLowerCase();
  addState.custName = document.getElementById('inp-name').value;
  addState.custId = null;
  addState.existingCustomer = false;
  document.getElementById('inp-name').classList.remove('filled');
  document.getElementById('phone-field').style.display = 'block';
  const drop = document.getElementById('ac-dropdown');
  const matches = customers.filter(c=>c.name.toLowerCase().includes(val) && val.length>0);
  if(!matches.length){ drop.classList.remove('show'); return; }
  drop.innerHTML = matches.slice(0,6).map(c=>`<div class="ac-item" onclick="selectAC('${c.id}','${escHtml(c.name)}','${c.phone||''}')"><div class="ac-name">${c.name}</div><div class="ac-phone">${c.phone||'No phone'}</div></div>`).join('');
  drop.classList.add('show');
}
function selectAC(id,name,phone){
  document.getElementById('inp-name').value  = name;
  document.getElementById('inp-phone').value = phone;
  document.getElementById('inp-name').classList.add('filled');
  document.getElementById('phone-field').style.display = 'block';
  document.getElementById('ac-dropdown').classList.remove('show');
  addState.custId = id; addState.custName = name; addState.custPhone = phone; addState.existingCustomer = true;
}

function goStep2(){
  const name  = document.getElementById('inp-name').value.trim();
  const phone = document.getElementById('inp-phone').value.trim();
  if(!name){ toast(t('toastEnterName'),'error'); return; }
  addState.custName  = name;
  addState.custPhone = phone;
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'block';
  document.getElementById('step-1-bar').classList.add('active');
  document.getElementById('step-2-bar').classList.add('active');
  renderItemGrid();
  setPayStatus('unpaid');
}
function goStep1(){
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-1').style.display = 'block';
  document.getElementById('step-2-bar').classList.remove('active');
}

function renderItemGrid(){
  const grid = document.getElementById('item-grid');
  if(!grid) return;
  grid.innerHTML = ITEMS_CONFIG.map(it=>`
    <div class="item-tile" id="tile-${it.id}" onclick="toggleItem('${it.id}')">
      <div class="check"></div>
      <div class="emoji">${it.emoji}</div>
      <div class="iname">${it.name}</div>
      <div class="iprice">${it.othersOnly ? 'Enter amount' : '₹'+it.price+'/kg'}</div>
    </div>`).join('');
  renderItemDetails();
}
function toggleItem(id){
  if(addState.selectedItems[id]){
    delete addState.selectedItems[id];
    document.getElementById('tile-'+id).classList.remove('selected');
  } else {
    const cfg = ITEMS_CONFIG.find(i=>i.id===id);
    addState.selectedItems[id] = {qty:'', pricePerKg:cfg.price, directTotal:''};
    document.getElementById('tile-'+id).classList.add('selected');
  }
  renderItemDetails();
}
function renderItemDetails(){
  const el = document.getElementById('item-details');
  if(!el) return;
  const selected = Object.keys(addState.selectedItems);
  if(!selected.length){ el.innerHTML=''; return; }
  el.innerHTML = selected.map(id=>{
    const cfg = ITEMS_CONFIG.find(i=>i.id===id);
    const st  = addState.selectedItems[id];

    if(cfg.othersOnly){
      return `<div class="item-row">
        <div class="item-row-title">${cfg.emoji} ${cfg.name} <span style="font-size:11px;color:var(--text3);font-weight:400;">(enter amount directly)</span></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:13px;color:var(--text3);">₹</span>
          <input class="item-total-input" id="inp-direct-${id}" type="number" placeholder="Enter total amount"
            value="${st.directTotal}" min="0" style="flex:1;"
            oninput="onDirect('${id}')" />
        </div>
      </div>`;
    }

    const sub = calcLineTotal(st);
    return `<div class="item-row">
      <div class="item-row-title">${cfg.emoji} ${cfg.name}</div>
      <div class="item-row-fields">
        <div>
          <input type="number" id="inp-qty-${id}" placeholder="Qty" value="${st.qty}" min="0" step="0.1"
            oninput="onQtyPrice('${id}')" />
          <div class="field-lbl">${t('qtyLabel')}</div>
        </div>
        <div>
          <input type="number" id="inp-price-${id}" placeholder="₹/kg" value="${st.pricePerKg}" min="0"
            oninput="onQtyPrice('${id}')" />
          <div class="field-lbl">${t('priceLabel')}</div>
        </div>
        <div>
          <input type="number" id="inp-sub-${id}" placeholder="Auto" value="${sub||''}" min="0"
            style="background:var(--cream2);color:var(--text2);"
            oninput="onSubtotal('${id}')" />
          <div class="field-lbl">${t('subLabel')}</div>
        </div>
      </div>
      <div class="item-total-row">
        <span class="or-divider">${t('orDirect')}</span>
        <input class="item-total-input" id="inp-direct-${id}" type="number" placeholder="${t('directPlaceholder')}" value="${st.directTotal}" min="0"
          oninput="onDirect('${id}')" />
      </div>
    </div>`;
  }).join('');
}

function onQtyPrice(id){
  const qty   = document.getElementById('inp-qty-'+id).value;
  const price = document.getElementById('inp-price-'+id).value;
  addState.selectedItems[id].qty        = qty;
  addState.selectedItems[id].pricePerKg = price;
  addState.selectedItems[id].directTotal = '';
  const di = document.getElementById('inp-direct-'+id);
  if(di) di.value = '';
  const sub = (qty!==''&&price!=='') ? parseFloat(qty)*parseFloat(price) : '';
  const si = document.getElementById('inp-sub-'+id);
  if(si) si.value = sub!==''?sub:'';
}
function onSubtotal(id){
  const val = document.getElementById('inp-sub-'+id).value;
  addState.selectedItems[id].directTotal  = val;
  addState.selectedItems[id].qty          = '';
  addState.selectedItems[id].pricePerKg   = '';
  const qi = document.getElementById('inp-qty-'+id);   if(qi) qi.value='';
  const pi = document.getElementById('inp-price-'+id); if(pi) pi.value='';
  const di = document.getElementById('inp-direct-'+id);if(di) di.value=val;
}
function onDirect(id){
  const val = document.getElementById('inp-direct-'+id).value;
  addState.selectedItems[id].directTotal  = val;
  addState.selectedItems[id].qty          = '';
  addState.selectedItems[id].pricePerKg   = '';
  const qi = document.getElementById('inp-qty-'+id);   if(qi) qi.value='';
  const pi = document.getElementById('inp-price-'+id); if(pi) pi.value='';
  const si = document.getElementById('inp-sub-'+id);   if(si) si.value=val;
}

function calcLineTotal(st){
  if(st.directTotal!=='') return Number(st.directTotal);
  if(st.qty!=='' && st.pricePerKg!=='') return parseFloat(st.qty)*parseFloat(st.pricePerKg);
  return 0;
}

function setPayStatus(s){
  addState.payStatus = s;
  document.getElementById('pay-opt-paid').className   = 'pay-opt' + (s==='paid'?   ' active-paid':'');
  document.getElementById('pay-opt-partial').className= 'pay-opt' + (s==='partial'?' active-partial':'');
  document.getElementById('pay-opt-unpaid').className = 'pay-opt' + (s==='unpaid'? ' active-unpaid':'');
  document.getElementById('partial-field').className  = 'partial-field' + (s==='partial'?' show':'');
}

/* ═══════════════════════════════════════
   SAVE BILL
   ═══════════════════════════════════════ */
function saveBill(){
  const sel = addState.selectedItems;
  if(!Object.keys(sel).length){ toast(t('toastSelectItem'),'error'); return; }

  const items = Object.entries(sel).map(([id,st])=>{
    const cfg = ITEMS_CONFIG.find(i=>i.id===id);
    const lineTotal = calcLineTotal(st);
    return {id, name:cfg.name, emoji:cfg.emoji, qty:st.qty||'', pricePerKg:st.pricePerKg||cfg.price, directTotal:st.directTotal!==''?Number(st.directTotal):null, lineTotal};
  }).filter(i=>i.lineTotal>0);

  if(!items.length){ toast(t('toastEnterQty'),'error'); return; }

  const total    = items.reduce((s,i)=>s+i.lineTotal,0);
  const billNo   = records.length + 1;
  const ts       = Date.now();
  const itemSummary = items.map(i=>i.name+(i.qty?` ${i.qty}kg`:'')).join(', ');

  let paidAmount = 0;
  if(addState.payStatus === 'paid')    paidAmount = total;
  if(addState.payStatus === 'unpaid')  paidAmount = 0;
  if(addState.payStatus === 'partial'){
    paidAmount = parseFloat(document.getElementById('inp-partial').value)||0;
    if(paidAmount > total) paidAmount = total;
  }

  let custId = addState.custId;
  if(custId){
    const cust = customers.find(c=>c.id===custId);
    if(cust){
      if(addState.custPhone) cust.phone = addState.custPhone;
      cust.lastUsed = Date.now();
      customers.sort((a,b)=>b.lastUsed-a.lastUsed);
      save();
    }
  } else {
    custId = saveCustomer(addState.custName, addState.custPhone);
  }

  const record = {
    id: 'b'+ts, billNo, ts,
    custId,
    custName: addState.custName, custPhone: addState.custPhone,
    items, total, itemSummary,
    payStatus: addState.payStatus,
    paidAmount,
    payments:[{ts, amt:paidAmount, note:'Initial'}]
  };

  records.unshift(record);
  save();
  renderList();
  closeAddBill();
  viewBill(record.id);
  postToSheets(record);
}

/* ═══════════════════════════════════════
   BILL VIEW
   ═══════════════════════════════════════ */
function viewBill(id){
  viewingBillId = id;
  const r = records.find(x=>x.id===id);
  if(!r) return;
  const st    = billStatus(r);
  const paid  = r.paidAmount || 0;
  const due   = r.total - paid;
  const hasPhone = r.custPhone && r.custPhone.length>=10;

  const itemRows = r.items.map(i=>{
    const desc = i.directTotal!=null ? t('lumpSum') : `${i.qty} kg × ₹${i.pricePerKg} = ₹${fmtAmt(i.lineTotal)}`;
    return `<tr><td>${i.emoji} ${i.name}<br><small style="color:var(--text3)">${desc}</small></td><td>₹${fmtAmt(i.lineTotal)}</td></tr>`;
  }).join('');

  const paidInfoHtml = st==='partial'
    ? `<div class="receipt-paid-info">${t('paidInfo')}: ₹${fmtAmt(paid)} &nbsp;|&nbsp; <span style="color:var(--red)">${t('dueInfo')}: ₹${fmtAmt(due)}</span></div>` : '';

  document.getElementById('bill-view-body').innerHTML = `
    <div class="bill-receipt">
      <div class="receipt-header">
        <div class="receipt-store">${t('storeName')}</div>
        <div class="receipt-addr">${t('receiptAddr')}</div>
      </div>
      <div class="receipt-meta">
        <span>Bill #${r.billNo}</span>
        <span>${fmtDate(r.ts)} ${fmtTime(r.ts)}</span>
      </div>
      <div class="receipt-customer">
        <div class="rc-name">${r.custName} ${r.custId?`<span style="font-size:11px;font-weight:400;color:var(--text3);">(${r.custId})</span>`:''}</div>
        <div class="rc-phone">${r.custPhone||t('noPhone')}</div>
      </div>
      <div class="receipt-table">
        <table><thead><tr><th>${t('itemCol')}</th><th>${t('amountCol')}</th></tr></thead>
        <tbody>${itemRows}</tbody></table>
      </div>
      <div class="receipt-total"><span>${t('totalLabel')}</span><span>₹${fmtAmt(r.total)}</span></div>
      ${paidInfoHtml}
      <div class="receipt-stamp"><div class="stamp ${st}">${st==='partial'?t('stampPartial'):st==='paid'?t('stampPaid'):t('stampUnpaid')}</div></div>
    </div>

    <!-- ── PHONE EDIT PANEL ── -->
    <div id="edit-phone-area-${id}" class="edit-phone-area" style="display:none;">
      <div class="edit-phone-label">${t('mobileNumberLabel')} — ${hasPhone ? t('editPhoneTitle') : t('addPhoneTitle')}</div>
      <div class="edit-phone-row">
        <input type="tel" id="edit-phone-input-${id}" maxlength="10" placeholder="10-digit mobile number" value="${r.custPhone||''}"
          oninput="this.style.borderColor=this.value.length===10?'var(--green)':'var(--border)'"
          onkeydown="if(event.key==='Enter') savePhone('${id}')"/>
        <button class="save-btn" onclick="savePhone('${id}')">Save</button>
        <button class="cancel-btn" onclick="editPhone('${id}')">✕</button>
      </div>
      <div class="edit-phone-note">${t('phoneSaveNote')}</div>
    </div>
    <button onclick="editPhone('${id}')" id="edit-phone-btn-${id}"
      style="width:100%;padding:11px;border-radius:30px;border:2px solid ${hasPhone?'var(--border)':'var(--gold)'};background:${hasPhone?'#fff':'var(--gold-pale)'};font-size:14px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;color:${hasPhone?'var(--text2)':'#7a5f00'};margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;">
      ${hasPhone?t('editPhone'):t('addPhone')}
    </button>
    <div class="share-btns">
      <button class="share-btn wa" onclick="shareWA('${id}')">${t('whatsappBtn')}</button>
      <button class="share-btn sms" onclick="shareSMS('${id}')">${t('smsBtn')}</button>
    </div>
    ${st==='partial'?`<button class="btn btn-balance" onclick="sendBalanceBill('${id}')" style="margin-bottom:8px;">${t('balanceBillBtn')} (${t('dueInfo')} ₹${fmtAmt(due)})</button>`:''}
    <button class="btn btn-gold" onclick="downloadBillPDF('${id}')" style="margin-bottom:8px;">${t('downloadPDF')}</button>
    <button class="btn btn-outline" onclick="closeAllSheets()" style="margin-bottom:16px;">${t('doneBtn')}</button>
    ${st==='paid'
      ? `<div class="toggle-status-btn" style="background:var(--green-light);color:var(--green);cursor:default;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:16px;">🔒 ${t('paidLocked')}</div>`
      : `<div style="margin-top:4px;padding:10px 14px;background:var(--red-light);border-radius:var(--radius-sm);border:1.5px solid var(--red);margin-bottom:8px;">
          <div style="font-size:11px;color:var(--red);font-weight:700;margin-bottom:6px;">⚠️ ${t('markPaidWarning')}</div>
          <button class="toggle-status-btn" onclick="toggleBillStatus('${id}')" style="margin-bottom:0;border-color:var(--red);color:var(--red);">${t('markPaid')}</button>
        </div>`
    }
  `;
  openSheet('sheet-bill');
}

function editPhone(id){
  const area = document.getElementById('edit-phone-area-'+id);
  if(!area) return;
  const isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    const inp = document.getElementById('edit-phone-input-'+id);
    if(inp){ inp.focus(); inp.select(); }
  }
}
function savePhone(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;
  const phone = (document.getElementById('edit-phone-input-'+id).value||'').trim();
  if(phone && phone.length<10){ toast(t('toastPhoneInvalid'),'error'); return; }
  r.custPhone = phone;
  const cust = customers.find(c=>c.id===r.custId);
  if(cust){ cust.phone = phone; cust.lastUsed = Date.now(); }
  else saveCustomer(r.custName, phone);
  save();
  renderList();
  toast(phone ? 'Mobile number saved ✓' : 'Mobile number removed', 'success');
  postToSheets(r, 'update');
  viewBill(id);
}

function toggleBillStatus(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;
  const st = billStatus(r);
  if(st==='paid'){
    toast('This bill is already paid and cannot be unmarked', 'error');
    return;
  }
  // Confirmation dialog before permanently locking the bill as paid
  if(!confirm(t('confirmMarkPaid') || `Mark Bill #${r.billNo} for ${r.custName} as PAID? This cannot be undone.`)) return;
  r.paidAmount = r.total; r.payStatus = 'paid';
  save(); renderList(); viewBill(id);
  toast('Marked as Paid ✓', 'success');
  postToSheets(r, 'update');
}

/* ═══════════════════════════════════════
   PDF BILL GENERATION
   ═══════════════════════════════════════ */
function buildBillNode(r){
  const st   = billStatus(r);
  const paid = r.paidAmount||0;
  const due  = r.total - paid;
  const stampColor = st==='paid'?'#2f6b46':st==='partial'?'#a8761f':'#ab3324';
  const stampText  = st==='paid'?'PAID':st==='partial'?'PARTIAL':'UNPAID';

  const itemRows = r.items.map(i=>{
    const desc = i.directTotal!=null ? 'Lump sum' : `${i.qty} kg × Rs.${i.pricePerKg} = Rs.${fmtAmt(i.lineTotal)}`;
    return `<tr>
      <td style="padding:8px 14px;border-bottom:1px solid #ece0bf;font-size:13px;font-family:Georgia,serif;">${i.name}<br><span style="font-size:11px;color:#a18d70;font-family:Arial,sans-serif;">${desc}</span></td>
      <td style="padding:8px 14px;border-bottom:1px solid #ece0bf;font-size:13px;text-align:right;font-weight:700;font-family:'Courier New',monospace;">Rs.${fmtAmt(i.lineTotal)}</td>
    </tr>`;
  }).join('');

  const partialHtml = st==='partial' ? `<div style="padding:7px 14px;font-size:12px;color:#6c5c46;background:#f7f1e2;font-family:Arial,sans-serif;">Paid: <b style="font-family:'Courier New',monospace;">Rs.${fmtAmt(paid)}</b> &nbsp;|&nbsp; <span style="color:#ab3324;">Due: <b style="font-family:'Courier New',monospace;">Rs.${fmtAmt(due)}</b></span></div>` : '';

  const div = document.createElement('div');
  div.style.cssText = 'width:370px;background:#fff;font-family:Arial,sans-serif;border-radius:10px;overflow:hidden;';
  div.innerHTML = `
    <div style="background:#8a2a1f;color:#fff;padding:18px 14px;text-align:center;border-bottom:3px solid #a8761f;">
      <div style="font-size:19px;font-weight:700;font-family:Georgia,serif;">Srinivasa Store</div>
      <div style="font-size:11px;opacity:.85;margin-top:3px;">Amangal, Telangana</div>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 14px;background:#f7f1e2;font-size:11px;color:#6c5c46;font-family:'Courier New',monospace;border-bottom:1px dashed #ddc99c;">
      <span>Bill #${r.billNo}</span><span>${fmtDate(r.ts)} ${fmtTime(r.ts)}</span>
    </div>
    <div style="padding:11px 14px;border-bottom:1px solid #ddc99c;">
      <div style="font-weight:700;font-size:15px;color:#221c14;">${r.custName}</div>
      <div style="font-size:12px;color:#a18d70;margin-top:2px;font-family:'Courier New',monospace;">${r.custPhone||'—'}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="font-size:10px;text-transform:uppercase;color:#a18d70;padding:7px 14px;text-align:left;border-bottom:1px solid #ddc99c;">Item</th>
        <th style="font-size:10px;text-transform:uppercase;color:#a18d70;padding:7px 14px;text-align:right;border-bottom:1px solid #ddc99c;">Amount</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="display:flex;justify-content:space-between;padding:12px 14px;font-size:16px;font-weight:700;border-top:2px solid #ddc99c;color:#221c14;font-family:'Courier New',monospace;">
      <span style="font-family:Arial,sans-serif;">Total</span><span>Rs.${fmtAmt(r.total)}</span>
    </div>
    ${partialHtml}
    <div style="text-align:center;padding:14px;">
      <span style="display:inline-block;padding:8px 20px;border-radius:5px;font-size:19px;font-weight:700;font-family:Georgia,serif;letter-spacing:2px;border:3px double ${stampColor};color:${stampColor};transform:rotate(-4deg);">${stampText}</span>
    </div>
    <div style="text-align:center;font-size:11px;color:#a18d70;padding:10px;border-top:1px solid #ece0bf;">Thank you for your business!</div>
  `;
  return div;
}

async function generatePdfBlob(r){
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;background:#f7f1e2;padding:20px;';
  const node = buildBillNode(r);
  wrapper.appendChild(node);
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(node, {scale:2, useCORS:true, backgroundColor:'#ffffff'});
    const imgData = canvas.toDataURL('image/png');
    const {jsPDF} = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait', unit:'pt', format:'a4'});
    const pageW = pdf.internal.pageSize.getWidth();
    const imgW  = pageW - 40;
    const imgH  = (canvas.height * imgW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 20, 20, imgW, imgH);
    return pdf.output('blob');
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function downloadBillPDF(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;
  toast('Generating PDF…');
  try {
    const blob = await generatePdfBlob(r);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Bill_${r.billNo}_${r.custName.replace(/\s+/g,'_')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast('PDF downloaded ✓ 📄', 'success');
  } catch(e){ toast('PDF generation failed','error'); }
}

function shareWA(id){
  const r = records.find(x=>x.id===id);
  if(!r) return;

  const st = billStatus(r);
  const stEmoji = st==='paid'?'✅':st==='partial'?'⚠️':'❌';
  const paid = r.paidAmount||0;
  const due  = r.total - paid;

  let itemLines = r.items.map(i=>{
    const desc = i.directTotal!=null ? '' : ` (${i.qty} kg × ₹${i.pricePerKg})`;
    return `  • ${i.name}${desc}: ₹${fmtAmt(i.lineTotal)}`;
  }).join('\n');

  let waText = `*${t('storeName')}* — ${t('receiptAddr')}\n\n${t('waDear')} *${r.custName}*,\n${t('waBillDetails')}\n\nBill #${r.billNo} | ${fmtDate(r.ts)}\n\n${itemLines}\n\n*${t('totalLabel')}: ₹${fmtAmt(r.total)}*\n${stEmoji} ${t('waStatus')}: *${st.toUpperCase()}*`;
  if(st==='partial') waText += `\n${t('waPaid')}: ₹${fmtAmt(paid)} · ${t('dueInfo')}: ₹${fmtAmt(due)}`;
  waText += `\n\n${t('waThank')}`;

  const waUrl = r.custPhone && r.custPhone.length >= 10
    ? `https://wa.me/91${r.custPhone}?text=${encodeURIComponent(waText)}`
    : `https://wa.me/?text=${encodeURIComponent(waText)}`;
  window.open(waUrl, '_blank');
  toast('Opening WhatsApp… 💬', 'success');
}
function shareSMS(id){
  const r = records.find(x=>x.id===id);
  if(!r.custPhone){ toast('No phone number saved','error'); return; }
  const st = billStatus(r);
  let lines = r.items.map(i=>`${i.name}${i.qty?' '+i.qty+'kg':''}: Rs.${i.lineTotal}`).join(', ');
  let msg = `Srinivasa Store, Amangal. Bill#${r.billNo} ${fmtDate(r.ts)}. ${r.custName}: ${lines}. Total Rs.${r.total}.`;
  if(st==='partial') msg+=` Paid Rs.${r.paidAmount||0}, Due Rs.${r.total-(r.paidAmount||0)}.`;
  msg += ` Status: ${st.toUpperCase()}.`;
  window.open(`sms:+91${r.custPhone}?body=${encodeURIComponent(msg)}`,'_blank');
  toast('Opening SMS…');
}

/* ═══════════════════════════════════════
   GOOGLE SHEETS (ONE-DIRECTIONAL PUSH)
   ═══════════════════════════════════════ */
async function postToSheetsRaw(r, action='new'){
  const url = localStorage.getItem(SHEETS_URL_KEY)||'';
  if(!url || url==='YOUR_URL_HERE' || url==='') return;
  const payload = {
    action:     action,
    billNo:     r.billNo,
    date:       fmtDate(r.ts),
    custName:   r.custName,
    custPhone:  r.custPhone||'',
    items:      r.itemSummary,
    total:      r.total,
    paidAmount: r.paidAmount||0,
    status:     billStatus(r).toUpperCase()
  };
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(payload)
  });
}

const SHEETS_REMINDER_KEY = 'srini_sheets_reminder_shown';
async function postToSheets(r, action='new'){
  const url = localStorage.getItem(SHEETS_URL_KEY)||'';
  if(!url || url==='YOUR_URL_HERE' || url===''){
    if(action !== 'new' && !localStorage.getItem(SHEETS_REMINDER_KEY)){
      toast('Tip: Set up Google Sheets in ⚙️ Settings to auto-sync bills', '');
      localStorage.setItem(SHEETS_REMINDER_KEY, '1');
    }
    return;
  }
  try {
    await postToSheetsRaw(r, action);
    toast(action==='new' ? 'Saved to Sheets ✓ 📊' : 'Sheets updated ✓ 📊', 'success');
  } catch(e){
    console.error('Sheets sync error:', e);
    toast('Sheets sync failed — check URL in Settings ⚙️', 'error');
  }
}

/* ═══════════════════════════════════════
   TWO-DIRECTIONAL GOOGLE SHEETS SYNC (PULL & MERGE)
   ═══════════════════════════════════════ */
async function syncWithSheets() {
  const url = localStorage.getItem(SHEETS_URL_KEY) || '';
  if(!url || url === 'YOUR_URL_HERE' || url === ''){
    toast(t('sheetsUrlMissing') || 'Please set your Google Sheets URL in Settings first.', 'error');
    return;
  }
  toast(t('syncing') || 'Syncing with Google Sheets...', 'success');
  try {
    // Append action=pull param to trigger Apps Script doGet() reading
    const response = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=pull');
    if(!response.ok) throw new Error('Sync network response was not ok');
    const sheetBills = await response.json();
    
    if(!Array.isArray(sheetBills)) {
      throw new Error('Google Sheets sync response was not a valid list');
    }

    let localUpdated = false;
    let sheetUpdateQueue = [];

    const localBillsMap = new Map();
    records.forEach(r => localBillsMap.set(Number(r.billNo), r));

    const sheetBillsMap = new Map();
    sheetBills.forEach(sb => sheetBillsMap.set(Number(sb.billNo), sb));

    // Step 1: Check all bills from Google Sheets
    for (const sb of sheetBills) {
      const billNo = Number(sb.billNo);
      const localBill = localBillsMap.get(billNo);
      const sheetPaid = Number(sb.paidAmount) || 0;
      const sheetTotal = Number(sb.total) || 0;
      
      if (localBill) {
        const localPaid = Number(localBill.paidAmount) || 0;
        
        if (localPaid < sheetPaid) {
          // Sheets has a larger paid amount (newer payments updated on sheet)
          localBill.paidAmount = sheetPaid;
          localBill.payStatus = billStatusFromPaid(sheetPaid, sheetTotal);
          localBill.payments = localBill.payments || [];
          localBill.payments.push({
            ts: Date.now(),
            amt: sheetPaid - localPaid,
            note: 'Payment synced from Google Sheets'
          });
          localUpdated = true;
        } else if (localPaid > sheetPaid) {
          // Local PWA has a higher paid amount (newer offline updates) -> update Sheets later
          sheetUpdateQueue.push(localBill);
        }
      } else {
        // Bill exists in Google Sheets but not in PWA -> Import it
        let custId = null;
        const cleanName = sb.custName || 'Unknown Customer';
        const cleanPhone = sb.custPhone || '';
        
        // Match customer
        const existingCust = customers.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
        if (existingCust) {
          custId = existingCust.id;
          if (cleanPhone && !existingCust.phone) {
            existingCust.phone = cleanPhone;
          }
        } else {
          custId = saveCustomer(cleanName, cleanPhone);
        }

        const importedItems = [{
          id: 'others',
          name: 'Imported Item',
          emoji: '📦',
          qty: '',
          pricePerKg: 0,
          directTotal: sheetTotal,
          lineTotal: sheetTotal
        }];

        const parsedDate = parseDateString(sb.date);

        const newRecord = {
          id: 'b' + parsedDate,
          billNo: billNo,
          ts: parsedDate,
          custId: custId,
          custName: cleanName,
          custPhone: cleanPhone,
          items: importedItems,
          total: sheetTotal,
          itemSummary: sb.items || 'Imported items',
          payStatus: sb.status ? sb.status.toLowerCase() : 'unpaid',
          paidAmount: sheetPaid,
          payments: [{ ts: parsedDate, amt: sheetPaid, note: 'Imported from Google Sheets' }]
        };
        
        records.push(newRecord);
        localUpdated = true;
      }
    }

    // Step 2: Find any local-only bills and queue them to upload to Google Sheets
    for (const r of records) {
      const billNo = Number(r.billNo);
      if (!sheetBillsMap.has(billNo)) {
        sheetUpdateQueue.push(r);
      }
    }

    // Step 3: Run queued updates sequentially
    if (sheetUpdateQueue.length > 0) {
      toast((t('updatingSheets') || 'Syncing updates to Google Sheets...') + ` (${sheetUpdateQueue.length})`, 'success');
      for (const r of sheetUpdateQueue) {
        const isUpdate = sheetBillsMap.has(Number(r.billNo));
        await postToSheetsRaw(r, isUpdate ? 'update' : 'new');
      }
    }

    // Step 4: Save & update layout
    if (localUpdated) {
      records.sort((a, b) => b.ts - a.ts);
      save();
      renderList();
    }

    toast(t('syncSuccess') || 'Sync completed! ✓ 📊', 'success');
  } catch (error) {
    console.error('Sheets sync error:', error);
    toast(t('syncFailed') || 'Sync failed. Check connection & Google Sheets URL.', 'error');
  }
}

function parseDateString(dateStr) {
  // Format: "04 Jul 2026"
  const parts = dateStr.split(' ');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const monthStr = parts[1];
    const year = parseInt(parts[2], 10);
    const months = {
      jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
      jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
    };
    const month = months[monthStr.toLowerCase().slice(0,3)] || 0;
    const d = new Date(year, month, day, 12, 0, 0); // avoid timezone shifts
    return d.getTime();
  }
  return Date.now();
}

/* ═══════════════════════════════════════
   LOCAL DATABASE BACKUP & RESTORE
   ═══════════════════════════════════════ */
function exportBackup(){
  const backupData = {
    version: 1,
    timestamp: Date.now(),
    records: records,
    customers: customers,
    nextCustIdNum: nextCustIdNum,
    sheetsUrl: localStorage.getItem(SHEETS_URL_KEY) || ''
  };
  const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `SOS_Bills_Backup_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t('backupExported') || 'Backup exported ✓', 'success');
}

function importBackup(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    try {
      const backupData = JSON.parse(e.target.result);
      if(!backupData.records || !backupData.customers){
        throw new Error('Invalid backup file structure');
      }
      
      if(confirm(t('confirmImport') || 'This will overwrite all current bills and customer data. Proceed?')){
        records = backupData.records;
        customers = backupData.customers;
        if(backupData.nextCustIdNum){
          nextCustIdNum = backupData.nextCustIdNum;
          localStorage.setItem('srini_next_cust_id', String(nextCustIdNum));
        }
        if(backupData.sheetsUrl !== undefined){
          localStorage.setItem(SHEETS_URL_KEY, backupData.sheetsUrl);
          SHEETS_URL = backupData.sheetsUrl;
        }
        save();
        renderList();
        applyLang();
        toast(t('backupImported') || 'Backup restored successfully! 🎉', 'success');
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch(err) {
      console.error(err);
      toast(t('backupFail') || 'Failed to restore backup: invalid format', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* ═══════════════════════════════════════
   CUSTOMER LEDGER
   ═══════════════════════════════════════ */
function openLedger(){
  renderLedger();
  openSheet('sheet-ledger');
}
function closeLedger(){
  closeSheet('sheet-ledger');
  if(!document.querySelector('.sheet.open')) document.getElementById('overlay').classList.remove('open');
}
function renderLedger(){
  const custMap = {};
  records.forEach(r=>{
    const key = r.custId || r.custName;
    if(!custMap[key]) custMap[key]={id:r.custId||'', name:r.custName, phone:r.custPhone||'', totalBilled:0, totalPaid:0, count:0};
    custMap[key].totalBilled += r.total;
    custMap[key].totalPaid  += (r.paidAmount||0);
    custMap[key].count++;
  });
  const list = Object.values(custMap).sort((a,b)=>(b.totalBilled-b.totalPaid)-(a.totalBilled-a.totalPaid));
  const el = document.getElementById('ledger-body');
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="empty-state"><div class="es-icon">📒</div><div class="es-text">No customers yet</div></div>'; return; }
  el.innerHTML = '<div class="ledger-list">'+list.map(c=>{
    const due = c.totalBilled - c.totalPaid;
    return `<div class="ledger-cust" onclick="openLedgerDetail('${c.id}')">
      <div class="ledger-cust-top">
        <div><div class="ledger-cust-name">${c.name} <span style="font-size:11px;font-weight:400;color:var(--text3);">${c.id}</span></div><div class="ledger-cust-phone">${c.phone||'No phone'}</div></div>
        <div class="ledger-cust-top-right">
          <button class="ledger-quick-add" onclick="event.stopPropagation();openAddBillForCustomer('${c.id}')">+ Bill</button>
          <div class="ledger-cust-bal ${due>0?'owed':'clear'}">₹${fmtAmt(Math.abs(due))} ${due>0?'DUE':'CLEAR'}</div>
        </div>
      </div>
      <div class="ledger-cust-meta">${c.count} bill(s) · Total: ₹${fmtAmt(c.totalBilled)} · Paid: ₹${fmtAmt(c.totalPaid)}</div>
    </div>`;
  }).join('')+'</div>';
}

function openLedgerDetail(custId){
  const custBills = records.filter(r=>r.custId===custId);
  const totalBilled = custBills.reduce((s,r)=>s+r.total,0);
  const totalPaid   = custBills.reduce((s,r)=>s+(r.paidAmount||0),0);
  const due         = totalBilled - totalPaid;
  const cust        = customers.find(c=>c.id===custId)||{};
  const name        = cust.name || (custBills[0]&&custBills[0].custName) || '';

  const dueBillsCount = custBills.filter(r=>(r.total-(r.paidAmount||0))>0).length;

  document.getElementById('ledger-detail-title').textContent = `${name} (${custId})`;
  const body = document.getElementById('ledger-detail-body');
  if(!body) return;
  body.innerHTML = `
    <div class="ledger-add-bill-wrap">
      <button class="ledger-add-bill-btn" onclick="openAddBillForCustomer('${custId}')">+ Add Bill for ${escHtml(name)}</button>
    </div>
    <div class="ledger-balance-card">
      <div class="lbc-item"><div class="lbc-val">₹${fmtAmt(totalBilled)}</div><div class="lbc-lbl">Total Billed</div></div>
      <div class="lbc-item"><div class="lbc-val paid">₹${fmtAmt(totalPaid)}</div><div class="lbc-lbl">Total Paid</div></div>
      <div class="lbc-item"><div class="lbc-val owed">₹${fmtAmt(due)}</div><div class="lbc-lbl">Outstanding</div></div>
    </div>
    ${due>0 && dueBillsCount>1 ? `
    <div class="ledger-due-banner">
      <div>
        <div class="ldb-title">💰 Total Balance Due</div>
        <div class="ldb-sub">${dueBillsCount} bills pending · ₹${fmtAmt(due)} total</div>
      </div>
      <button onclick="sendTotalBalance('${custId}')">📤 Send Total</button>
    </div>` : ''}
    <div class="ledger-bills">
      <div class="section-title">Bills</div>
      ${custBills.map(r=>{
        const st = billStatus(r);
        const paid = r.paidAmount||0; const rdueAmt = r.total-paid;
        return `<div class="ledger-bill-row">
          <div class="ledger-bill-info" onclick="viewBill('${r.id}')" style="cursor:pointer;flex:1;">
            <div class="lbr-date">${fmtDate(r.ts)} · #${r.billNo}</div>
            <div class="lbr-items">${r.itemSummary}</div>
          </div>
          <div class="ledger-bill-amt">
            <div class="lba-total">₹${fmtAmt(r.total)}</div>
            ${st==='partial'?`<div class="lba-paid">Paid ₹${fmtAmt(paid)}</div><div class="lba-due">Due ₹${fmtAmt(rdueAmt)}</div><button onclick="sendBalanceBill('${r.id}')" style="margin-top:4px;padding:4px 8px;background:var(--gold);color:#fff;border:none;border-radius:8px;font-size:10px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Send Balance</button>`:''}
            ${st==='unpaid'?`<div class="lba-due">Unpaid</div>`:''}
            ${st==='paid'?`<div class="lba-paid">Paid</div>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${due>0?`
    <div class="pay-partial-section">
      <div class="pps-title">Record a Payment</div>
      <div class="pps-row">
        <input type="number" id="partial-pay-input" placeholder="₹ Amount received" min="1" max="${due}"/>
        <button class="pps-btn" onclick="recordPartialPayment('${custId}',${due})">Record</button>
      </div>
    </div>`:''}
  `;
  openSheet('sheet-ledger-detail');
}
function closeLedgerDetail(){
  closeSheet('sheet-ledger-detail');
}

function recordPartialPayment(custId, totalDue){
  const amt = parseFloat(document.getElementById('partial-pay-input').value)||0;
  if(amt<=0){ toast('Enter a valid amount','error'); return; }

  let remaining = amt;
  const custBills = records.filter(r=>r.custId===custId && (r.paidAmount||0)<r.total)
    .sort((a,b)=>a.ts-b.ts);

  for(const r of custBills){
    if(remaining<=0) break;
    const due = r.total - (r.paidAmount||0);
    const pay = Math.min(remaining, due);
    r.paidAmount = (r.paidAmount||0) + pay;
    r.payments   = r.payments||[];
    r.payments.push({ts:Date.now(), amt:pay, note:'Payment recorded from ledger'});
    if(r.paidAmount>=r.total) r.payStatus='paid';
    else r.payStatus='partial';
    remaining -= pay;
    postToSheets(r, 'update');
  }

  save(); renderList();
  toast(`₹${fmtAmt(amt)} payment recorded ✓`, 'success');
  openLedgerDetail(custId);
}

/* ═══════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════ */
function openSettings(){
  document.getElementById('settings-sheets-url').value = localStorage.getItem(SHEETS_URL_KEY)||'';
  openSheet('sheet-settings');
}
function closeSettings(){
  closeSheet('sheet-settings');
  if(!document.querySelector('.sheet.open')) document.getElementById('overlay').classList.remove('open');
}
function saveSheetsUrl(){
  const v = document.getElementById('settings-sheets-url').value.trim();
  localStorage.setItem(SHEETS_URL_KEY, v);
  SHEETS_URL = v;
  toast('Google Sheets URL saved ✓ 📊','success');
}
function clearData(){
  if(!confirm(t('confirmClear') || 'Delete ALL bills and customers? This cannot be undone.')) return;
  records=[]; customers=[]; save(); renderList(); closeSettings();
  toast('All data cleared');
}

/* ═══════════════════════════════════════
   LANGUAGE / భాష
   ═══════════════════════════════════════ */
const LANG_KEY = 'srini_lang';
let lang = localStorage.getItem(LANG_KEY) || 'en';

const T = {
  en: {
    storeName: 'Srinivasa Store',
    storeSub: 'Amangal, Telangana',
    sumBills: 'Bills',
    sumRevenue: 'Revenue',
    sumUnpaid: 'Unpaid',
    searchPlaceholder: 'Search by Bill ID or customer name…',
    emptyIcon: '📋', emptyText: 'No bills yet', emptySub: 'Tap + to add your first bill',
    noResults: 'No bills found', noResultsSub: 'Try a different Bill ID or name',
    addBill: 'Add Bill',
    recentCustomers: 'Recent Customers',
    noCustomers: 'No saved customers yet',
    custName: 'Customer Name',
    custNamePlaceholder: 'Type or select above…',
    phoneLabel: 'Phone Number',
    phoneOptional: '(optional — can add later)',
    phonePlaceholder: '10-digit mobile',
    continueBtn: 'Continue →',
    selectItems: 'Select Items',
    payment: 'Payment',
    paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid',
    paidOpt: '✓ Paid', partialOpt: '≈ Partial', unpaidOpt: '✗ Unpaid',
    amtPaidNow: 'Amount Paid Now (₹)',
    partialPlaceholder: 'e.g. 200',
    partialNote: 'Remaining will be tracked as outstanding balance.',
    saveBtn: 'Save & Generate Bill',
    qtyLabel: 'Qty (kg)', priceLabel: 'Price/kg', subLabel: 'Subtotal ₹',
    orDirect: 'OR direct total →', directPlaceholder: '₹ Total',
    itemCol: 'Item', amountCol: 'Amount', totalLabel: 'Total',
    lumpSum: 'Lump sum',
    stampPaid: 'PAID', stampPartial: 'PARTIAL', stampUnpaid: 'UNPAID',
    editPhone: '✏️ Edit Mobile Number', addPhone: '📱 Add Mobile Number',
    editPhoneTitle: 'Edit', addPhoneTitle: 'Add',
    mobileNumberLabel: '📱 Mobile Number',
    phoneSaveNote: 'Enter the 10-digit number without country code. This will be saved for future bills too.',
    whatsappBtn: '💬 WhatsApp',
    smsBtn: '✉️ SMS',
    balanceBillBtn: '💰 Send Balance Bill',
    downloadPDF: '📄 Download Bill as PDF',
    markUnpaid: 'Mark as Unpaid', markPaid: '✓ Mark as Paid',
    paidLocked: 'Paid (locked)',
    markPaidWarning: 'This action is permanent and cannot be undone.',
    confirmMarkPaid: 'Mark this bill as PAID? This cannot be undone.',
    doneBtn: 'Done',
    paidInfo: 'Paid', dueInfo: 'Due',
    ledgerBtn: '📒 Ledger',
    ledgerTitle: 'Customer Ledger',
    totalBilled: 'Total Billed', totalPaid: 'Total Paid', outstanding: 'Outstanding',
    billsTitle: 'Bills',
    noPhone: 'No phone',
    recordPayment: 'Record a Payment',
    payPlaceholder: '₹ Amount received',
    recordBtn: 'Record',
    due: 'DUE', clear: 'CLEAR',
    sendBalance: 'Send Balance',
    settingsTitle: 'Settings',
    langLabel: '🌐 Language / భాష',
    sheetsUrl: 'Google Sheets URL',
    sheetsPlaceholder: 'Paste Web App URL',
    sheetsHint: 'Paste your Google Apps Script deployment URL above to sync bills to Google Sheets automatically.',
    clearData: '🗑 Clear All Data',
    settingsSaved: 'Settings saved ✓',
    toastPayment: 'payment recorded ✓',
    toastClear: 'All data cleared',
    toastPDFGen: 'Generating PDF…',
    toastPDFDone: 'PDF downloaded ✓ 📄',
    toastPDFFail: 'PDF generation failed',
    toastPDFWA: 'PDF saved! Attach it in WhatsApp 📎',
    toastNoPhone: 'No phone number saved',
    toastSelectItem: 'Select at least one item',
    toastEnterQty: 'Enter quantity or total for items',
    toastEnterName: 'Please enter customer name',
    toastEnterAmt: 'Enter a valid amount',
    toastNoBal: 'No balance due for this bill',
    toastPhoneInvalid: 'Enter a valid 10-digit number',
    toastOpenSMS: 'Opening SMS…',
    toastOpenWA: 'Opening WhatsApp with balance bill…',
    toastBalCopied: 'Balance bill copied! (No phone saved)',
    toastNoAction: 'Could not complete action',
    toastSheetsSaved: 'Saved to Sheets ✓',
    toastSheetsErr: 'Sheets: unexpected response',
    toastSheetsFail: 'Sheets sync failed',
    confirmClear: 'Delete ALL bills and customers? This cannot be undone.',
    waDear: 'Dear',
    waBillDetails: 'Please find your bill details below.',
    waThank: 'Thank you! 🙏',
    waStatus: 'Status',
    waBalReminder: 'This is a reminder for your outstanding balance.',
    waTotal: 'Total', waPaid: 'Paid', waBalDue: 'Balance Due',
    waKindly: 'Kindly clear the balance at your earliest. Thank you! 🙏',
    totalOutstandingLabel: 'Total Outstanding Balance',
    receiptFooter: 'Thank you for your business!',
    receiptAddr: 'Amangal, Telangana',
    // New translations for sync/backup
    backupSection: 'Database Backup & Restore',
    exportBackupBtn: '📥 Export Backup',
    importBackupBtn: '📤 Import Backup',
    syncSheetsBtn: '🔄 Sync Google Sheets',
    backupExported: 'Backup exported ✓',
    backupImported: 'Backup restored successfully! 🎉',
    backupFail: 'Failed to restore backup: invalid format',
    confirmImport: 'This will overwrite all current bills and customer data. Proceed?',
    sheetsUrlMissing: 'Please set your Google Sheets URL in Settings first.',
    syncing: 'Syncing with Google Sheets...',
    updatingSheets: 'Syncing updates to Google Sheets...',
    syncSuccess: 'Sync completed! ✓ 📊',
    syncFailed: 'Sync failed. Check connection & Google Sheets URL.'
  },
  te: {
    storeName: 'శ్రీనివాస స్టోర్',
    storeSub: 'అమంగల్, తెలంగాణ',
    sumBills: 'బిల్లులు',
    sumRevenue: 'ఆదాయం',
    sumUnpaid: 'బాకీ',
    searchPlaceholder: 'బిల్ నంబర్ లేదా పేరు వెతకండి…',
    emptyIcon: '📋', emptyText: 'ఇంకా బిల్లులు లేవు', emptySub: '+ నొక్కి మొదటి బిల్ జోడించండి',
    noResults: 'బిల్లులు కనుగొనబడలేదు', noResultsSub: 'వేరే బిల్ నంబర్ లేదా పేరు ప్రయత్నించండి',
    addBill: 'బిల్ జోడించు',
    recentCustomers: 'తాజా కస్టమర్లు',
    noCustomers: 'కస్టమర్లు లేరు',
    custName: 'కస్టమర్ పేరు',
    custNamePlaceholder: 'పేరు టైప్ చేయండి…',
    phoneLabel: 'ఫోన్ నంబర్',
    phoneOptional: '(ఐచ్ఛికం — తర్వాత జోడించవచ్చు)',
    phonePlaceholder: '10-అంకెల మొబైల్',
    continueBtn: 'కొనసాగు →',
    selectItems: 'వస్తువులు ఎంచుకోండి',
    payment: 'చెల్లింపు',
    paid: 'చెల్లించారు', partial: 'పాక్షికం', unpaid: 'చెల్లించలేదు',
    paidOpt: '✓ చెల్లించారు', partialOpt: '≈ పాక్షికం', unpaidOpt: '✗ చెల్లించలేదు',
    amtPaidNow: 'ఇప్పుడు చెల్లించిన మొత్తం (₹)',
    partialPlaceholder: 'ఉదా. 200',
    partialNote: 'మిగిలిన బాకీ ట్రాక్ చేయబడుతుంది.',
    saveBtn: 'సేవ్ చేసి బిల్ రూపొందించు',
    qtyLabel: 'పరిమాణం (కే.జీ)', priceLabel: '₹/కే.జీ', subLabel: 'మొత్తం ₹',
    orDirect: 'లేదా నేరుగా మొత్తం →', directPlaceholder: '₹ మొత్తం',
    itemCol: 'వస్తువు', amountCol: 'మొత్తం', totalLabel: 'మొత్తం',
    lumpSum: 'నేరు మొత్తం',
    stampPaid: 'చెల్లించారు', stampPartial: 'పాక్షికం', stampUnpaid: 'చెల్లించలేదు',
    editPhone: '✏️ మొబైల్ నంబర్ సవరించు', addPhone: '📱 మొబైల్ నంబర్ జోడించు',
    editPhoneTitle: 'సవరించు', addPhoneTitle: 'జోడించు',
    mobileNumberLabel: '📱 మొబైల్ నంబర్',
    phoneSaveNote: 'దేశ కోడ్ లేకుండా 10-అంకెల నంబర్ నమోదు చేయండి. ఇది భవిష్యత్ బిల్లులకు కూడా సేవ్ అవుతుంది.',
    whatsappBtn: '💬 వాట్సాప్',
    smsBtn: '✉️ SMS',
    balanceBillBtn: '💰 బాకీ బిల్ పంపు',
    downloadPDF: '📄 PDF డౌన్‌లోడ్ చేయి',
    markUnpaid: 'చెల్లించలేదు అని గుర్తించు', markPaid: '✓ చెల్లించారు అని గుర్తించు',
    paidLocked: 'చెల్లించారు (లాక్)',
    markPaidWarning: 'ఈ చర్య శాశ్వతమైనది మరియు రద్దు చేయలేరు.',
    confirmMarkPaid: 'ఈ బిల్లును చెల్లించారు అని గుర్తించాలా? ఇది రద్దు చేయలేరు.',
    doneBtn: 'పూర్తయింది',
    paidInfo: 'చెల్లించారు', dueInfo: 'బాకీ',
    ledgerBtn: '📒 లెడ్జర్',
    ledgerTitle: 'కస్టమర్ లెడ్జర్',
    totalBilled: 'మొత్తం బిల్', totalPaid: 'మొత్తం చెల్లింపు', outstanding: 'బాకీ',
    billsTitle: 'బిల్లులు',
    noPhone: 'ఫోన్ లేదు',
    recordPayment: 'చెల్లింపు నమోదు చేయి',
    payPlaceholder: '₹ స్వీకరించిన మొత్తం',
    recordBtn: 'నమోదు',
    due: 'బాకీ', clear: 'క్లియర్',
    sendBalance: 'బాకీ పంపు',
    settingsTitle: 'సెట్టింగ్స్',
    langLabel: '🌐 Language / భాష',
    sheetsUrl: 'గూగుల్ షీట్స్ URL',
    sheetsPlaceholder: 'వెబ్ యాప్ URL అతికించండి',
    sheetsHint: 'బిల్లులను గూగుల్ షీట్స్‌కు స్వయంచాలకంగా సమకాలీకరించడానికి పైన URL అతికించండి.',
    clearData: '🗑 అన్ని డేటా తొలగించు',
    settingsSaved: 'సెట్టింగ్స్ సేవ్ అయ్యాయి ✓',
    toastPayment: 'చెల్లింపు నమోదు అయింది ✓',
    toastClear: 'అన్ని డేటా తొలగించబడింది',
    toastPDFGen: 'PDF రూపొందిస్తోంది…',
    toastPDFDone: 'PDF డౌన్‌లోడ్ అయింది ✓ 📄',
    toastPDFFail: 'PDF రూపొందించడం విఫలమైంది',
    toastPDFWA: 'PDF సేవ్ అయింది! వాట్సాప్‌లో జోడించండి 📎',
    toastNoPhone: 'ఫోన్ నంబర్ సేవ్ చేయబడలేదు',
    toastSelectItem: 'కనీసం ఒక వస్తువు ఎంచుకోండి',
    toastEnterQty: 'వస్తువులకు పరిమాణం లేదా మొత్తం నమోదు చేయండి',
    toastEnterName: 'కస్టమర్ పేరు నమోదు చేయండి',
    toastEnterAmt: 'సరైన మొత్తం నమోదు చేయండి',
    toastNoBal: 'ఈ బిల్లుకు బాకీ లేదు',
    toastPhoneInvalid: '10-అంకెల నంబర్ నమోదు చేయండి',
    toastOpenSMS: 'SMS తెరుచుకుంటోంది…',
    toastOpenWA: 'వాట్సాప్ బాకీ బిల్‌తో తెరుచుకుంటోంది…',
    toastBalCopied: 'బాకీ బిల్ కాపీ అయింది! (ఫోన్ లేదు)',
    toastNoAction: 'చర్య పూర్తి చేయలేకపోయింది',
    toastSheetsSaved: 'షీట్స్‌లో సేవ్ అయింది ✓',
    toastSheetsErr: 'షీట్స్: ఊహించని ప్రతిస్పందన',
    toastSheetsFail: 'షీట్స్ సమకాలీకరణ విఫలమైంది',
    confirmClear: 'అన్ని బిల్లులు మరియు కస్టమర్లను తొలగించాలా? ఇది రద్దు చేయలేరు.',
    waDear: 'ప్రియమైన',
    waBillDetails: 'మీ బిల్ వివరాలు దిగువన ఉన్నాయి.',
    waThank: 'ధన్యవాదాలు! 🙏',
    waStatus: 'స్థితి',
    waBalReminder: 'మీ బాకీ మొత్తానికి గుర్తు చేయడానికి ఇది.',
    waTotal: 'మొత్తం', waPaid: 'చెల్లించారు', waBalDue: 'బాకీ మొత్తం',
    waKindly: 'దయచేసి వీలైనంత త్వరగా బాకీ చెల్లించండి. ధన్యవాదాలు! 🙏',
    totalOutstandingLabel: 'మొత్తం బాకీ బ్యాలెన్స్',
    receiptFooter: 'మీ వ్యాపారానికి ధన్యవాదాలు!',
    receiptAddr: 'అమంగల్, తెలంగాణ',
    // Telugu sync/backup translations
    backupSection: 'డేటాబేస్ బ్యాకప్ & పునరుద్ధరణ',
    exportBackupBtn: '📥 బ్యాకప్ ఎగుమతి',
    importBackupBtn: '📤 బ్యాకప్ పునరుద్ధరించు',
    syncSheetsBtn: '🔄 గూగుల్ షీట్స్ సింక్ చేయి',
    backupExported: 'బ్యాకప్ ఎగుమతి అయింది ✓',
    backupImported: 'బ్యాకప్ విజయవంతంగా పునరుద్ధరించబడింది! 🎉',
    backupFail: 'బ్యాకప్ పునరుద్ధరించడం విఫలమైంది: తప్పుడు ఫార్మాట్',
    confirmImport: 'ఇది ప్రస్తుత బిల్లులు మరియు కస్టమర్ల డేటాను భర్తీ చేస్తుంది. కొనసాగించాలా?',
    sheetsUrlMissing: 'దయచేసి సెట్టింగ్స్‌లో గూగుల్ షీట్స్ URL సెట్ చేయండి.',
    syncing: 'గూగుల్ షీట్స్‌తో సమకాలీకరిస్తోంది...',
    updatingSheets: 'గూగుల్ షీట్స్‌కు అప్‌డేట్స్ సమకాలీకరిస్తోంది...',
    syncSuccess: 'సమకాలీకరణ పూర్తయింది! ✓ 📊',
    syncFailed: 'సమకాలీకరణ విఫలమైంది. ఇంటర్నెట్ కనెక్షన్ మరియు షీట్స్ URL తనిఖీ చేయండి.'
  }
};

function t(key){ return (T[lang] && T[lang][key]) || T['en'][key] || key; }

function setLang(l){
  lang = l;
  localStorage.setItem(LANG_KEY, l);
  document.getElementById('lang-btn-en').className = 'pay-opt' + (l==='en'?' active-paid':'');
  document.getElementById('lang-btn-te').className = 'pay-opt' + (l==='te'?' active-paid':'');
  applyLang();
  renderList();
}

function applyLang(){
  const sn = document.querySelector('.store-name');
  if(sn) sn.textContent = t('storeName');
  const ss = document.querySelector('.store-sub');
  if(ss) ss.textContent = t('storeSub');

  setTxt('sum-count-lbl', t('sumBills'));
  setTxt('sum-revenue-lbl', t('sumRevenue'));
  setTxt('sum-unpaid-lbl', t('sumUnpaid'));

  const si = document.getElementById('search-input');
  if(si) si.placeholder = t('searchPlaceholder');

  const lf = document.querySelector('.bb-ledger');
  if(lf) lf.innerHTML = t('ledgerBtn');
  setTxt('bb-add-label', t('addBill'));

  setTxt('add-bill-title', t('addBill'));
  setTxt('lbl-recent-customers', t('recentCustomers'));
  setTxt('lbl-cust-name', t('custName'));
  const inp = document.getElementById('inp-name');
  if(inp) inp.placeholder = t('custNamePlaceholder');
  setTxt('lbl-phone', t('phoneLabel'));
  setTxt('lbl-phone-opt', t('phoneOptional'));
  const inpPh = document.getElementById('inp-phone');
  if(inpPh) inpPh.placeholder = t('phonePlaceholder');
  setTxt('btn-continue', t('continueBtn'));
  setTxt('lbl-select-items', t('selectItems'));
  setTxt('lbl-payment', t('payment'));
  setTxt('pay-opt-paid', t('paidOpt'));
  setTxt('pay-opt-partial', t('partialOpt'));
  setTxt('pay-opt-unpaid', t('unpaidOpt'));
  setTxt('lbl-amt-paid', t('amtPaidNow'));
  const inp2 = document.getElementById('inp-partial');
  if(inp2) inp2.placeholder = t('partialPlaceholder');
  setTxt('partial-note', t('partialNote'));
  setTxt('btn-save-bill', t('saveBtn'));

  setTxt('ledger-sheet-title', t('ledgerTitle'));

  setTxt('settings-sheet-title', t('settingsTitle'));
  setTxt('lbl-sheets-url', t('sheetsUrl'));
  const surl = document.getElementById('settings-sheets-url');
  if(surl) surl.placeholder = t('sheetsPlaceholder');
  setTxt('lbl-sheets-hint', t('sheetsHint'));
  setTxt('btn-clear-data', t('clearData'));
  
  // Set localized text for new sync and backup buttons
  setTxt('btn-sync-sheets', t('syncSheetsBtn'));
  setTxt('lbl-backup-section', t('backupSection'));
  setTxt('btn-export-backup', t('exportBackupBtn'));
  setTxt('btn-import-backup', t('importBackupBtn'));
}

function setTxt(id, txt){
  const el = document.getElementById(id);
  if(el) el.textContent = txt;
}

function escHtml(s){ return s.replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

/* ═══════════════════════════════════════
   INIT
   ═══════════════════════════════════════ */
if(lang==='te'){
  const enBtn = document.getElementById('lang-btn-en');
  const teBtn = document.getElementById('lang-btn-te');
  if (enBtn) enBtn.className='pay-opt';
  if (teBtn) teBtn.className='pay-opt active-paid';
}
applyLang();
renderList();

/* ═══════════════════════════════════════════
   PWA: SERVICE WORKER + INSTALL PROMPT
   ═══════════════════════════════════════════ */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('SW registered:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              toast('App updated! Refresh to get latest version.', 'success');
            }
          });
        });
      })
      .catch(err => console.log('SW registration failed:', err));
  });
}

function updateOnlineStatus(){
  const banner = document.getElementById('offline-banner');
  if(!banner) return;
  if(!navigator.onLine){
    banner.classList.add('show');
    document.body.classList.add('is-offline');
  } else {
    banner.classList.remove('show');
    document.body.classList.remove('is-offline');
  }
}
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if(!localStorage.getItem('pwa_install_dismissed')){
    setTimeout(() => {
      const ib = document.getElementById('install-banner');
      if (ib) ib.classList.add('show');
    }, 3000);
  }
});

const installBtn = document.getElementById('install-btn');
if (installBtn) {
  installBtn.addEventListener('click', () => {
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(result => {
      if(result.outcome === 'accepted'){
        toast('App installed successfully! 🎉', 'success');
      }
      deferredInstallPrompt = null;
      document.getElementById('install-banner').classList.remove('show');
    });
  });
}

function dismissInstall(){
  const ib = document.getElementById('install-banner');
  if (ib) ib.classList.remove('show');
  localStorage.setItem('pwa_install_dismissed', '1');
}

if(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone){
  const ib = document.getElementById('install-banner');
  if (ib) ib.style.display = 'none';
}

/* ═══════════════════════════════════════════
   GOOGLE APPS SCRIPT CODE (REFERENCE TEMPLATE)
   ═══════════════════════════════════════════
   
   Copy and deploy this code in your Google Sheets Extensions -> Apps Script:

   function doGet(e) {
     try {
       var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
       
       // 1. PULL SYNC action -> Reads all rows and returns JSON
       if (e && e.parameter && e.parameter.action === 'pull') {
         if (sheet.getLastRow() === 0) {
           return ContentService
             .createTextOutput(JSON.stringify([]))
             .setMimeType(ContentService.MimeType.JSON);
         }
         
         var data = sheet.getDataRange().getValues();
         var bills = [];
         
         for (var i = 1; i < data.length; i++) {
           var row = data[i];
           bills.push({
             billNo:     Number(row[0]) || 0,
             date:       String(row[1]) || '',
             custName:   String(row[2]) || '',
             custPhone:  String(row[3]) || '',
             items:      String(row[4]) || '',
             total:      Number(row[5]) || 0,
             paidAmount: Number(row[6]) || 0,
             status:     String(row[7]) || 'UNPAID'
           });
         }
         
         return ContentService
           .createTextOutput(JSON.stringify(bills))
           .setMimeType(ContentService.MimeType.JSON);
       }
       
       // Legacy write via URL parameters
       if (e && e.parameter && e.parameter.billNo) {
         return handleWrite(sheet, e.parameter);
       }
       
       return ContentService
         .createTextOutput(JSON.stringify({result: 'error', message: 'No parameters'}))
         .setMimeType(ContentService.MimeType.JSON);
         
     } catch(err) {
       return ContentService
         .createTextOutput(JSON.stringify({result: 'error', message: err.toString()}))
         .setMimeType(ContentService.MimeType.JSON);
     }
   }

   function doPost(e) {
     try {
       var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
       var p;
       
       if (e.postData && e.postData.contents) {
         p = JSON.parse(e.postData.contents);
       } else {
         p = e.parameter;
       }
       
       return handleWrite(sheet, p);
       
     } catch(err) {
       return ContentService
         .createTextOutput(JSON.stringify({result: 'error', message: err.toString()}))
         .setMimeType(ContentService.MimeType.JSON);
     }
   }

   function handleWrite(sheet, p) {
     if (sheet.getLastRow() === 0) {
       sheet.appendRow(['Bill #', 'Date', 'Customer', 'Phone', 'Items', 'Total (₹)', 'Paid (₹)', 'Status']);
       sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#8a2a1f').setFontColor('#ffffff');
     }

     var newRow = [
       Number(p.billNo),
       p.date,
       p.custName,
       p.custPhone || '',
       p.items,
       Number(p.total),
       Number(p.paidAmount) || 0,
       p.status
     ];

     if (p.action === 'update') {
       var data = sheet.getDataRange().getValues();
       for (var i = 1; i < data.length; i++) {
         if (String(data[i][0]) === String(p.billNo)) {
           sheet.getRange(i + 1, 1, 1, 8).setValues([newRow]);
           return ContentService
             .createTextOutput(JSON.stringify({result: 'updated', row: i + 1}))
             .setMimeType(ContentService.MimeType.JSON);
         }
       }
     }

     sheet.appendRow(newRow);
     return ContentService
       .createTextOutput(JSON.stringify({result: 'success'}))
       .setMimeType(ContentService.MimeType.JSON);
   }

   // DEPLOYMENT INSTRUCTIONS:
   // 1. In Google Sheets: Extensions -> Apps Script
   // 2. Clear all placeholder code and paste this entire template. Save (💾).
   // 3. Deploy -> New deployment.
   // 4. Set Type: Web App | Execute as: Me | Who has access: Anyone.
   // 5. Deploy, authorize permissions, and copy the Web App URL.
   // 6. In Srinivasa Store PWA settings, paste the URL to activate.
   
   ═══════════════════════════════════════════ */
