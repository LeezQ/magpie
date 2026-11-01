// The provider page manages models only; user authentication has one owner.
let host;
window.stxDraw = function(box) {
  host=box;
  if (!host) return;
  host.hidden=false;
  const card=el('section','stx-account'), who=el('div','stx-head');
  const u=window.stxUser?.current;
  who.append(icon('stallionx'),el('strong','',t('StallionX account')));
  const row=el('div','stxu-account-row');
  row.append(el('span','stx-note',u?.state==='authenticated' ? (u.profile?.email||u.email||'') : t('Sign in')));
  const go=el('button','text primary',t('Open user center'));go.type='button';go.onclick=()=>show('stallion-wallet');
  row.append(go);card.append(who,row);
  // the wallets that can pay, when the account is in a team (stallionx-payers.js)
  const payers=el('div','stx-payers');payers.hidden=true;card.append(payers);
  if(u?.state==='authenticated')import('/stallionx-payers.js').then(()=>window.stxPayers.mount(payers)).catch(statusErr);
  host.replaceChildren(card);
};
window.stxUser?.subscribe(()=>{if(host?.isConnected)window.stxDraw(host);});
