let player, enemy, decks = {};
const SAVE_KEY = "dungeonSave";
const classFiles = [
  "characters/warrior.json",
  "characters/archer.json",
  "characters/mage.json",
  "characters/classless.json"
];
const HAND_SIZE = 2;
const HP_ANIM_MS = 500;
const SWIPE_FLIP_THRESHOLD = 40; // px
const SWIPE_VERTICAL_CANCEL = 30;
const LONGPRESS_MS = 500;
const LONGPRESS_MOVE_CANCEL = 12;

let hand = [];
let roundActionUsed = false; // limits player to 1 play OR 1 discard per combat round
let pendingNextEnemy = false;
let roomsCleared = 0;

function drawHand() {
  hand = [];

  // Combine Equips + Consumables
  const combinedDeck = [...decks.equips_common, 
                          ...decks.equips_rare, 
                          ...decks.equips_epic, 
                          ...decks.equips_legendary , 
                          ...decks.consumables];
  for (let i = 0; i < HAND_SIZE; i++) {
    const card = combinedDeck[Math.floor(Math.random() * combinedDeck.length)];
    hand.push(card);
  }

  renderHand();
}
function slugifyName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getEquipImageSrc(card) {
  const r = String(card?.rarity || "Common").toLowerCase();
  // folder names: equips_common, equips_rare, equips_epic, equips_legendary
  return `images/equips/${slugifyName(card.name)}.png`;
}

function getEquipImageHTML(card, extraClass = "") {
  // Only show images for gear (as requested)
  if (!card || !["weapon", "armor", "any"].includes(card.type)) return "";

  const src = getEquipImageSrc(card);
  return `
    <img
      class="card-img ${extraClass}"
      src="${src}"
      alt="${card.name}"
      loading="lazy"
      onerror="this.style.display='none'"
    />
  `;
}

function attachSwipeFlip(cardEl) {
  let startX = 0, startY = 0;
  let moved = false;
  let wasSwipe = false;

  cardEl.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    moved = false;
    wasSwipe = false;
  }, { passive: true });

  cardEl.addEventListener("touchmove", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // If user is scrolling vertically, don't treat as swipe flip
    if (Math.abs(dy) > SWIPE_VERTICAL_CANCEL && Math.abs(dy) > Math.abs(dx)) {
      moved = true;
    }
  }, { passive: true });

  cardEl.addEventListener("touchend", (e) => {
    if (moved) return;

    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;

    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (Math.abs(dx) > SWIPE_FLIP_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      cardEl.classList.toggle("flipped");
      wasSwipe = true;
      // prevent the subsequent click from starting the game
      cardEl.dataset.justSwiped = "1";
      setTimeout(() => delete cardEl.dataset.justSwiped, 250);
    }
  }, { passive: true });
}
function waitHpAnim() {
  return new Promise(res => setTimeout(res, HP_ANIM_MS));
}
function spawnNextEnemyNow() {
  spawnRandomEnemy();
  updateUI();

  // If you want to be extra safe:
  document.getElementById("discard-overlay")?.classList.add("hidden");
  setDiscardLock(false);
}


function renderEquipment() {
  const slots = ["weapon", "armor", "any"];

  slots.forEach(slot => {
    const slotEl = document.getElementById(`slot-${slot}`);
    if (!slotEl) return;

    const card = player?.equipment?.[slot];

    // Reset base class + rarity class (slotEl is a .slot div)
    slotEl.className = `slot`; // keep base styling

    if (card) {
      const rarityClass = `rarity-${String(card.rarity || "Common").toLowerCase()}`;
      slotEl.classList.add(rarityClass);

      const statText = formatCardStats(card);
      const desc = String(card.description ?? "").replace(/\n/g, "<br>");

      slotEl.innerHTML = `
        ${getEquipImageHTML(card, "slot-img")}
        <div class="card-name">${card.name}</div>
        <div class="stat">${statText}</div>
        <div class="description">${desc}</div>
      `;
    } else {
      slotEl.innerHTML = slot.charAt(0).toUpperCase() + slot.slice(1);
    }
  });
}

function setDiscardLock(locked) {
  const attackBtn = document.getElementById("attackBtn");
  if (!attackBtn) return;

  attackBtn.disabled = locked;
  attackBtn.classList.toggle("disabled", locked);

  // Optional visual feedback
  attackBtn.style.opacity = locked ? "0.4" : "1";
  attackBtn.style.pointerEvents = locked ? "none" : "auto";
}





// 1️⃣ Define handleCardClick first
function handleCardClick(idx, e) {
  const card = hand[idx];
  if (!card) return;

  // Combat-round limit: you may only play/equip/use ONE card OR discard ONE card per round.
  // Use SHIFT+click on a card in-hand to discard it as your action for the round.
  if (e && e.shiftKey) {
    // if (roundActionUsed) {
    //   alert("You already took an action this round. Press Attack to resolve combat.");
    //   return;
    // }
    if (!confirm(`Discard ${card.name}?`)) return;
    roundActionUsed = true;
    hand.splice(idx, 1);
    renderHand();
    showDiscardOverlay();

    // Archer special: discard 1 card → deal 2 damage before combat (as written on the class card)
    if (player && player.name === "Archer" && enemy && enemy.currentHp > 0) {
      enemy.currentHp = Math.max(0, enemy.currentHp - 2);
      renderEnemy();
      updateUI();
      saveGame();
      if (enemy.currentHp === 0) {
        alert(`${enemy.name} defeated!`);
        roundActionUsed = false;
        nextEnemy();
      }
    }
    return;
  }

  // Consumable cards
  if (card.type === "consumable") {
    if (confirm(`Use ${card.name}?`)) {
      roundActionUsed = true;
      applyConsumable(card);
      hand.splice(idx, 1);
      renderHand();
      updateUI();
    }
    return;
  }

  // Determine target slot
  let slot = null;

  if (card.type === "weapon") slot = "weapon";
  else if (card.type === "armor") slot = "armor";
  else if (card.type === "any" && player.slots.any) slot = "any"; // classless only
  else {
    alert("Cannot equip this card.");
    return;
  }

  // Check if slot is empty
  const currentCard = player.equipment[slot];

  let confirmMsg;
  if (currentCard !== null && currentCard !== undefined && currentCard.name !== undefined) {
    // Slot occupied, confirm replacement
    confirmMsg = `Replace ${currentCard.name} with ${card.name}?`;
  } else {
    // Slot empty, confirm equip
    confirmMsg = `Are you sure you want to equip ${card.name}?`;
  }

  // Ask for confirmation
  if (!confirm(confirmMsg)) return;

  // Equip card
  roundActionUsed = true;

  // find target equip slot element (the ones in the player panel)
  const slotEl =
    slot === "weapon" ? document.getElementById("equip-slot-weapon") :
    slot === "armor"  ? document.getElementById("equip-slot-armor")  :
    slot === "any"    ? document.getElementById("equip-slot-any")    :
    null;

  // the clicked hand element (this is important for animation)
  const handCardEl = e?.currentTarget || e?.target?.closest?.(".hand-card");

  // run animation, then actually apply equip + remove from hand
  animateEquipFromHandToSlot(handCardEl, slotEl, () => {
    equipCard(card);          // now supports weapon/armor/any
    hand.splice(idx, 1);      // remove from hand after animation finishes
    playEquipSound(card.type, card.rarity);
    renderHand();
    updateUI();
    saveGame();
  });
  return;
}



function cardToHandHTML(card) {
  if (!card) return "";

  const rarityClass = `rarity-${String(card.rarity || "Common").toLowerCase()}`;
  const statVal = formatCardStats(card);     // ✅ shows atk + armor
  const desc = String(card.description ?? "");

  return `
    <div class="hand-card ${rarityClass}">
      ${getEquipImageHTML(card)}
      <strong>${card.name}</strong><br>
      <span class="stat">${statVal}</span><br>
      <em class="description">${desc}</em>
    </div>
  `;
}

function formatCardStats(card) {
  if (!card) return "";

  const parts = [];
  if (card.attack != null) parts.push(`+${card.attack} atk`);
  if (card.armor  != null) parts.push(`+${card.armor} def`);

  // For non-equips, keep your old behavior for heal/dmg if desired
  if (!parts.length) {
    if (card.heal   != null) parts.push(`+${card.heal} heal`);
    if (card.damage != null) parts.push(`+${card.damage} dmg`);
  }

  return parts.join(" / ");
}
function attachLongPressDiscard(cardEl, idx) {
  let timer = null;
  let startX = 0, startY = 0;
  let fired = false;

  cardEl.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    fired = false;

    timer = setTimeout(() => {
      fired = true;
      cardEl.dataset.longPress = "1";

      const card = hand[idx];
      if (!card) return;

      if (!confirm(`Discard ${card.name}?`)) return;

      hand.splice(idx, 1);
      renderHand();
      showDiscardOverlay?.();
      saveGame?.();
    }, LONGPRESS_MS);
  }, { passive: true });

  cardEl.addEventListener("touchmove", (e) => {
    if (!timer || !e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (Math.hypot(dx, dy) > LONGPRESS_MOVE_CANCEL) {
      clearTimeout(timer);
      timer = null;
    }
  }, { passive: true });

  cardEl.addEventListener("touchend", () => {
    if (timer) clearTimeout(timer);
    timer = null;

    // If long-press triggered, block the follow-up click
    if (fired) {
      setTimeout(() => delete cardEl.dataset.longPress, 250);
    }
  }, { passive: true });

  cardEl.addEventListener("click", (e) => {
    if (cardEl.dataset.longPress) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, true);
}
// 2️⃣ Then define renderHand
function renderHand() {
  console.log("Rendering hand:", hand);
  console.log('cards in hand:', hand.length);
  const handEl = document.getElementById("hand");
  if (!handEl) return;

  handEl.innerHTML = "";

  hand.forEach((card, idx) => {
    if (!card) return; // skip nulls
    console.log('card: ', card);

    const div = document.createElement("div");

    const rarityClass = `rarity-${String(card.rarity || "Common").toLowerCase()}`;
    div.className = `hand-card ${rarityClass}`;

    const statVal = formatCardStats(card);
    const desc = String(card.description ?? "");

    div.innerHTML = `
      ${getEquipImageHTML(card)}
      <strong>${card.name}</strong><br>
      <span class="stat">${statVal}</span><br>
      <em class="description">${desc}</em>
    `;

    div.onclick = (e) => handleCardClick(idx, e);
    attachLongPressDiscard(div, idx);
    handEl.appendChild(div);
    //playLootSound(card.rarity);
  });
}

function applyConsumable(card) {
  if (card.heal) {
    player.currentHp += card.heal;
    const maxHp = getMaxHp();
    if (player.currentHp > maxHp) player.currentHp = maxHp;
  }
  alert(`${card.name} used!`);
}





document.querySelectorAll(".slot").forEach(slot => {
  slot.ondragover = e => e.preventDefault();

  slot.ondrop = e => {
    const handIndex = e.dataTransfer.getData("handIndex");
    const card = hand[handIndex];

    if (!card) return;

    // Validate slot
    if (slot.dataset.slot !== "any" && card.type !== slot.dataset.slot) return;

    // Equip logic (same as before)
    equipToSlot(card, slot.dataset.slot);

    // Mark card as used
    hand[handIndex] = null;
    renderHand();
    saveGame();
  };
});
function enableConsumableClick() {
  document.querySelectorAll(".hand-card").forEach((div, idx) => {
    const card = hand[idx];
    if (!card) return;

    if (card.heal || card.buff || card.damage) {
      div.onclick = () => {
        if (card.heal) player.currentHp = Math.min(player.hp + getArmorHpBonus(), player.currentHp + card.heal);
        if (card.buff) player.attack += card.buff; // temporary buff for simplicity
        if (card.damage) enemy.currentHp -= card.damage;

        hand[idx] = null;
        renderHand();
        updateUI();
        saveGame();
      };
    }
  });
}


async function loadJSON(path) {
  const res = await fetch(path);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while loading ${path}`);
  }

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  // Helpful diagnostics when server returns HTML (404 page / index.html)
  if (text.trim().startsWith("<")) {
    console.error("loadJSON got HTML instead of JSON:", {
      path,
      status: res.status,
      contentType: ct,
      preview: text.slice(0, 120)
    });
    throw new Error(`Expected JSON but got HTML for ${path}. Check the file path.`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Bad JSON in:", path, "Preview:", text.slice(0, 200));
    throw e;
  }
}

async function init() {
	console.log('init');
  decks.equips_common = await loadJSON("decks/equips_common.json");
  decks.equips_rare = await loadJSON("decks/equips_rare.json");
  decks.equips_epic = await loadJSON("decks/equips_epic.json");
  decks.equips_legendary = await loadJSON("decks/equips_legendary.json");
  decks.consumables = await loadJSON("decks/consumables.json");
  // Split creatures by rarity
  decks.creatures_common = await loadJSON("decks/creatures_common.json");
  decks.creatures_rare = await loadJSON("decks/creatures_rare.json");
  decks.creatures_epic = await loadJSON("decks/creatures_epic.json");
  decks.creatures_legendary = await loadJSON("decks/creatures_legendary.json");

  const loaded = loadGame();
  if (!loaded) {
    showClassSelect();
  }
  document.getElementById("resetGame").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to reset the game?")) return;
    await resetGame();
  });
	document.getElementById("attackBtn").addEventListener("click", () => {
	  attack();
	});
  document.getElementById('sfxVolume').addEventListener('input', e => {
    SFX_VOLUME = parseFloat(e.target.value);
  });
}
async function resetGame() {
  // Clear saved state
  localStorage.removeItem(SAVE_KEY);

  // HARD screen switch (guarantees gameScreen is not covering classSelect)
  document.getElementById("gameScreen")?.classList.remove("active");
  document.getElementById("classSelect")?.classList.add("active");

  // Hide discard overlay + unlock attack
  document.getElementById("discard-overlay")?.classList.add("hidden");
  setDiscardLock(false);
  pendingNextEnemy = false;
  roundActionUsed = false;
  roomsCleared = 0;

  // Wipe game state
  player = null;
  enemy = null;
  hand = [];

  // Clear visuals
  document.getElementById("hand") && (document.getElementById("hand").innerHTML = "");

  // Clear sprite images + names + info panels
  [
    "monsterName", "monsterStats", "monsterDesc", "monsterSpriteName",
    "playerName", "playerStats", "playerPassive", "playerAbility", "playerSpriteName"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });

  document.getElementById("monsterSprite") && (document.getElementById("monsterSprite").innerHTML = "");
  document.getElementById("playerSprite") && (document.getElementById("playerSprite").innerHTML = "");

  // Reset HP bars
  const mhf = document.getElementById("monsterHpFill");
  const mht = document.getElementById("monsterHpText");
  const phf = document.getElementById("playerHpFill");
  const pht = document.getElementById("playerHpText");
  if (mhf) mhf.style.width = "0%";
  if (mht) mht.textContent = "0/0";
  if (phf) phf.style.width = "0%";
  if (pht) pht.textContent = "0/0";

  // Rebuild class selection cards
  await showClassSelect();
}

function drawHandForRoom() {
  const playableCards = [
    ...decks.equips_common,
    ...decks.equips_rare,
    ...decks.equips_epic,
    ...decks.equips_legendary,
    ...decks.consumables
  ];

  const card = playableCards[Math.floor(Math.random() * playableCards.length)];
  hand.push(card);

  playLootSound(card.rarity);  // ✅ sound only on draw
  renderHand();
  enableConsumableClick();
}


function nextEnemy() {
  spawnRandomEnemy();
  updateUI();

  // If hand is already too big for some reason, force discard
  showDiscardOverlay();
}
function handleKillReward() {
  const reward = drawReward();
  if (reward) {
    hand.push(reward);
    playLootSound(reward.rarity);
    renderHand();
    saveGame?.();
  }

  // If too many cards, pause progression and force discard
  if (hand.filter(Boolean).length > 2) {
    pendingNextEnemy = true;
    showDiscardOverlay();
    return; // DO NOT spawn next enemy yet
  }

  // Otherwise continue immediately
  nextEnemy();
}


function showDiscardOverlay() {
  const overlay = document.getElementById("discard-overlay");
  const discardHand = document.getElementById("discard-hand");
  if (!overlay || !discardHand) return;

  discardHand.innerHTML = "";

  const actualCards = hand.filter(Boolean);

  // ✅ If 2 or less: hide overlay AND re-enable attack
  if (actualCards.length <= 2) {
    overlay.classList.add("hidden");
    // ✅ if we were waiting, spawn the next enemy now
    if (pendingNextEnemy) {
      pendingNextEnemy = false;
      spawnNextEnemyNow();
    }
    setDiscardLock(false); // <-- THIS is what you're missing
    return;
  }

  // ✅ If 3+: show overlay AND disable attack
  overlay.classList.remove("hidden");
  setDiscardLock(true);

  actualCards.forEach((card) => {
    const div = document.createElement("div");
    div.className = `hand-card rarity-${String(card.rarity || "Common").toLowerCase()}`;

    const statText = (typeof formatCardStats === "function")
      ? formatCardStats(card)
      : [
          card.attack != null ? `${card.attack} atk` : null,
          card.armor  != null ? `${card.armor} armor` : null,
          card.heal   != null ? `${card.heal} heal` : null,
          card.damage != null ? `${card.damage} dmg` : null,
        ].filter(Boolean).join(" / ");

    div.innerHTML = `
      <strong>${card.name}</strong><br>
      <span class="stat">${statText}</span><br>
      <em class="description">${card.description ?? ""}</em>
    `;

    div.onclick = () => {
      // Forced discard - no confirm (add it back if you want)
      
     if (!confirm(`Discard ${card.name}?`)) return;
      const realIndex = hand.indexOf(card);
      if (realIndex !== -1) hand.splice(realIndex, 1);

      renderHand();
      showDiscardOverlay(); // refresh; will auto-unlock when <=2
      saveGame?.();
    };

    discardHand.appendChild(div);
  });
}


function setDiscardMode(on) {
  const overlay = document.getElementById("discard-overlay");
  const attackBtn = document.getElementById("attackBtn");

  if (overlay) overlay.classList.toggle("hidden", !on);
  if (attackBtn) attackBtn.disabled = on;

  // Optional: visually indicate disabled
  if (attackBtn) attackBtn.style.opacity = on ? "0.4" : "1";
}




async function attack() {
  // Block if discard overlay is up
  const overlay = document.getElementById("discard-overlay");
  if (overlay && !overlay.classList.contains("hidden")) return;

  if (isAttackAnimating) return;
  if (!player || !enemy) return;
  if (player.currentHp <= 0 || enemy.currentHp <= 0) return;

  isAttackAnimating = true;
  setAttackButtonEnabled(false);

  const playerEl = document.getElementById("playerSprite");
  const enemyEl  = document.getElementById("monsterSprite");

  const playerGoesFirst = (player.name === "Archer") || roundActionUsed;

  const doPlayerAttack = () => {
    const dmg = getTotalAtk();
    enemy.currentHp = Math.max(0, enemy.currentHp - dmg);
  };

  const doEnemyAttack = () => {
    enemyAttackDamage();
  };

  // helper: apply results + let HP bars animate fully
  async function applyAndWait() {
    renderEnemy();
    renderPlayer();
    updateUI();
    saveGame?.();
    await waitHpAnim(); // <-- lets bars finish
  }

  if (playerGoesFirst) {
    // Player strikes
    await animateAttackStrike(playerEl, enemyEl);
    doPlayerAttack();
    await applyAndWait();

    // If enemy died, wait already done -> now popup
    if (enemy.currentHp === 0) {
      alert(`${enemy.name} defeated!`);
      handleKillReward();
      isAttackAnimating = false;
      setAttackButtonEnabled(true);
      return;
    }

    // Enemy counter (delay is built-in via applyAndWait above)
    if (player.currentHp > 0) {
      await animateAttackStrike(enemyEl, playerEl);
      doEnemyAttack();
      await applyAndWait();

      if (player.currentHp === 0) {
        alert("You died!");
        await resetGame();
        isAttackAnimating = false;
        return;
      }
    }
  } else {
    // Enemy strikes
    await animateAttackStrike(enemyEl, playerEl);
    doEnemyAttack();
    await applyAndWait();

    if (player.currentHp === 0) {
      alert("You died!");
      await resetGame();
      isAttackAnimating = false;
      return;
    }

    // Player counter (delay is built-in via applyAndWait above)
    if (enemy.currentHp > 0) {
      await animateAttackStrike(playerEl, enemyEl);
      doPlayerAttack();
      await applyAndWait();

      if (enemy.currentHp === 0) {
        alert(`${enemy.name} defeated!`);
        handleKillReward();
        isAttackAnimating = false;
        setAttackButtonEnabled(true);
        return;
      }
    }
  }

  // End-of-round cleanup
  roundActionUsed = false;

  isAttackAnimating = false;

  // Re-enable unless discard overlay is active
  const overlay2 = document.getElementById("discard-overlay");
  const discardUp = overlay2 && !overlay2.classList.contains("hidden");
  setAttackButtonEnabled(!discardUp);
}




// function drawCard() {
//   // Combine decks
//   const playableCards = [...decks.equips_common, 
//                           ...decks.equips_rare, 
//                           ...decks.equips_epic, 
//                           ...decks.equips_legendary , 
//                           ...decks.consumables];
//   // Pick 1 random card
//   const card = playableCards[Math.floor(Math.random() * playableCards.length)];

//   hand.push(card); // add to existing hand
//   renderHand();
// }




function getArmorHpBonus() {
  // let bonus = 0;
  // if (player.equipment.armor) bonus += player.equipment.armor.armor || 0;
  // if (player.equipment.any)   bonus += player.equipment.any.armor   || 0;
  // return bonus;
  return 0;
}



function enemyAttackDamage() {
  // Enemy damage is reduced by your equipped armor.
  const raw = enemy.attack || 0;
  const reduced = Math.max(0, raw - getTotalDef());
  player.currentHp = Math.max(0, player.currentHp - reduced);
}

function pickFromPools(pools) {
  const combined = [];

  for (const p of pools) {
    if (Array.isArray(p) && p.length) combined.push(...p);
  }

  if (!combined.length) return null;

  const card = combined[Math.floor(Math.random() * combined.length)];

  // IMPORTANT: clone so equipment stats don't mutate deck cards
  return JSON.parse(JSON.stringify(card));
}



function drawReward() {
  const roll = Math.random() * 100;

  const pools =
    roll < 50 ? [decks.equips_common] :
    roll < 80 ? [decks.equips_rare, decks.equips_common] :
    roll < 95 ? [decks.equips_epic, decks.equips_rare, decks.equips_common] :
                [decks.equips_legendary, decks.equips_epic, decks.equips_rare];

  return pickFromPools(pools);
}



function equipCard(card) {
  if (!player || !player.equipment) return;

  if (card.type === "weapon") player.equipment.weapon = card;
  else if (card.type === "armor") player.equipment.armor = card;
  else if (card.type === "any") player.equipment.any = card;
  else return;

  updateUI?.();
  saveGame?.();
}





function useConsumable() {
  const c = decks.consumables[Math.floor(Math.random() * decks.consumables.length)];
  if (c.heal) player.currentHp = Math.min(getMaxHp(), player.currentHp + c.heal);
}

function updateUI() {
  if (!player) return;

  const maxHp = getMaxHp();
  player.currentHp = Math.min(player.currentHp, maxHp);

  renderPlayer();
  renderEnemy();

  // these are cheap, safe to call
  renderEquipment?.();
  renderHand();
}

let isAttackAnimating = false;

function getCenter(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Attacker lifts slightly, lunges to defender, bonks, defender shakes, attacker returns.
 * Returns a Promise that resolves when the whole sequence finishes.
 */
async function animateAttackStrike(attackerEl, defenderEl) {
  if (!attackerEl || !defenderEl) return;

  const aRect = attackerEl.getBoundingClientRect();
  const dRect = defenderEl.getBoundingClientRect();

  const aC = getCenter(aRect);
  const dC = getCenter(dRect);

  // Move most of the way to the defender (not fully center-to-center) so it looks like a "bonk"
  const dx = (dC.x - aC.x) * 0.78;
  const dy = (dC.y - aC.y) * 0.78;

  const lift = -14; // px upward

  // One animation with phases: lift -> dash -> recoil -> return
  const strike = attackerEl.animate(
    [
      { transform: "translate(0px, 0px)" , offset: 0 },
      { transform: `translate(0px, ${lift}px)` , offset: 0.28 },          // slow lift
      { transform: `translate(${dx}px, ${dy + lift}px)` , offset: 0.62 }, // fast lunge
      { transform: `translate(${dx * 0.92}px, ${dy * 0.92 + lift}px)` , offset: 0.72 }, // tiny recoil
      { transform: "translate(0px, 0px)" , offset: 1 }                    // smooth return
    ],
    {
      duration: 520,
      easing: "linear" // per-phase feel comes from offsets + separate easings below
    }
  );

  // Better feel: slow lift, fast dash, smooth return
  // We do this by timing + a second "feel" animation on top of the same keyframes via playbackRate.
  // Easiest: keep above and add defender shake at impact time.

  // Bonk timing: near the lunge peak
  const bonkAtMs = 520 * 0.62;

  // Defender shake at impact
  const shakePromise = new Promise((resolve) => {
    setTimeout(() => {
      const shake = defenderEl.animate(
        [
          { transform: "translate(0px, 0px)" },
          { transform: "translate(-6px, 0px)" },
          { transform: "translate(6px, 0px)" },
          { transform: "translate(-4px, 0px)" },
          { transform: "translate(4px, 0px)" },
          { transform: "translate(0px, 0px)" }
        ],
        { duration: 220, easing: "ease-out" }
      );
      shake.finished.then(resolve).catch(resolve);
    }, bonkAtMs);
  });

  await Promise.allSettled([strike.finished, shakePromise]);
}

/**
 * Disable attack button while animations are running.
 */
function setAttackButtonEnabled(enabled) {
  const btn = document.getElementById("attackBtn");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? "1" : "0.4";
  btn.style.pointerEvents = enabled ? "auto" : "none";
}

function animate(id) {
  const el = document.getElementById(id);
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 300);
}
function animateEquipFromHandToSlot(handCardEl, slotEl, onDone) {
  if (!handCardEl || !slotEl) { onDone?.(); return; }

  const start = handCardEl.getBoundingClientRect();
  const end = slotEl.getBoundingClientRect();

  // Clone the hand card so the real UI can update independently
  const ghost = handCardEl.cloneNode(true);
  ghost.style.position = "fixed";
  ghost.style.left = `${start.left}px`;
  ghost.style.top = `${start.top}px`;
  ghost.style.width = `${start.width}px`;
  ghost.style.height = `${start.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "9999";
  ghost.style.pointerEvents = "none";
  ghost.style.transition = "transform 260ms ease, opacity 260ms ease";
  ghost.style.transformOrigin = "center center";

  document.body.appendChild(ghost);

  // Compute translation to the CENTER of the slot
  const startCx = start.left + start.width / 2;
  const startCy = start.top + start.height / 2;

  const endCx = end.left + end.width / 2;
  const endCy = end.top + end.height / 2;

  const dx = endCx - startCx;
  const dy = endCy - startCy;

  // Kick animation next frame
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.65)`;
    ghost.style.opacity = "0.15";
  });

  // Cleanup
  setTimeout(() => {
    ghost.remove();
    onDone?.();
  }, 280);
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let SFX_VOLUME = 0.5; // 0.0 = mute, 1.0 = full

function playLootSound(rarity) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(audioCtx.destination);

  const ctx = audioCtx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "sine";
  let duration = 0.75;

  // Start silent (must be > 0 for exponential ramps)
  gain.gain.setValueAtTime(0.0001, now);

  const r = String(rarity || "Common").toLowerCase();

  if (r === "common") {
    duration = 0.3;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, now);

  } else if (r === "rare") {
    duration = .5;
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);

  } else if (r === "epic") {
    duration = 1;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.22);

  } else if (r === "legendary") {
    duration = 1.5;
    osc.type = "square";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.36);
  }
    // fade in quickly
    gain.gain.setValueAtTime(0.00005, now);
    gain.gain.exponentialRampToValueAtTime(0.12 * SFX_VOLUME, now + 0.02);

    // hold, then fade out near the end
    gain.gain.setValueAtTime(0.12 * SFX_VOLUME, now + (duration - 0.10));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.start(now);
  osc.stop(now + duration);
}
function playEquipSound(cardType, rarity) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  const ctx = audioCtx;
  const now = ctx.currentTime;

  // Output chain
  const out = ctx.createGain();
  out.gain.value = 0.9 * SFX_VOLUME;
  out.connect(ctx.destination);

  // helper: short envelope
  function env(g, peak, a, d) {
    g.gain.setValueAtTime(0.00005, now);
    g.gain.exponentialRampToValueAtTime(peak, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  }

  const r = String(rarity || "Common").toLowerCase();
  const rarityBoost =
    r === "legendary" ? 1.25 :
    r === "epic"      ? 1.15 :
    r === "rare"      ? 1.08 : 1.0;

  // --- ARMOR: metallic clink using filtered noise + quick ping ---
  if (cardType === "armor") {
    // Noise burst (clink texture)
    const bufferSize = Math.floor(ctx.sampleRate * 0.08);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(2600, now);
    band.Q.setValueAtTime(8, now);

    const g = ctx.createGain();
    env(g, 0.18 * rarityBoost * SFX_VOLUME, 0.005, 0.08);

    noise.connect(band);
    band.connect(g);
    g.connect(out);

    // Add a tiny "ping" oscillator for metallic edge
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);

    const og = ctx.createGain();
    env(og, 0.09 * rarityBoost * SFX_VOLUME, 0.004, 0.09);

    osc.connect(og);
    og.connect(out);

    noise.start(now);
    noise.stop(now + 0.09);
    osc.start(now);
    osc.stop(now + 0.10);
    return;
  }

  // --- WEAPON: quick “swish” using bandpassed noise + pitch sweep ---
  if (cardType === "weapon") {
    const bufferSize = Math.floor(ctx.sampleRate * 0.10);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(600, now);
    filt.frequency.exponentialRampToValueAtTime(2200, now + 0.10);
    filt.Q.setValueAtTime(1.2, now);

    const g = ctx.createGain();
    env(g, 0.14 * rarityBoost * SFX_VOLUME, 0.006, 0.12);

    noise.connect(filt);
    filt.connect(g);
    g.connect(out);

    // little “click” at start
    const clickOsc = ctx.createOscillator();
    clickOsc.type = "square";
    clickOsc.frequency.setValueAtTime(140, now);

    const cg = ctx.createGain();
    env(cg, 0.05 * rarityBoost * SFX_VOLUME, 0.002, 0.03);

    clickOsc.connect(cg);
    cg.connect(out);

    noise.start(now);
    noise.stop(now + 0.12);
    clickOsc.start(now);
    clickOsc.stop(now + 0.04);
    return;
  }

  // --- ANY / fallback: soft “pop” ---
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);

  const g = ctx.createGain();
  env(g, 0.10 * rarityBoost * SFX_VOLUME, 0.01, 0.10);

  osc.connect(g);
  g.connect(out);
  osc.start(now);
  osc.stop(now + 0.12);
}





function equipToSlot(card, targetSlot) {
  // Validate
  if (targetSlot !== "any" && card.type !== targetSlot) return;

  // Swap logic
  if (targetSlot === "weapon") {
    player.equipment.weapon = card;
  }

  if (targetSlot === "armor") {
    player.equipment.armor = card;
  }

  if (targetSlot === "any") {
    if (!player.slots.any) return;
    player.equipment.any = card;
  }

  updateEquipmentUI();
  updateUI();
}

function updateEquipmentUI() {
  document.querySelectorAll(".slot").forEach(slot => {
    const s = slot.dataset.slot;
    slot.classList.remove("filled");

    if (s === "weapon" && player.equipment.weapon) {
      slot.innerText = player.equipment.weapon.name;
      slot.classList.add("filled");
    }

    if (s === "armor" && player.equipment.armor) {
      slot.innerText = player.equipment.armor.map(a => a.name).join(", ");
      slot.classList.add("filled");
    }

    if (s === "any" && player.equipment.any) {
      slot.innerText = player.equipment.any.name;
      slot.classList.add("filled");
    }
  });
}
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");
}

function hideGameUI() {
  const game = document.getElementById("gameScreen"); // change id if yours differs
  if (game) game.classList.remove("active");
}

async function showClassSelect() {
	console.log('test');
	console.log("Loading classes:", classFiles);
  const container = document.getElementById("classes");
  container.innerHTML = "";

  for (const file of classFiles) {
    const data = await loadJSON(file);

    const div = document.createElement("div");
    div.className = "class-card";
    div.innerHTML = `
	  <div class="class-card-inner">
		<div class="class-card-front">
		  <img 
			src="images/${data.name.toLowerCase()}.png"
			alt="${data.name}"
			class="class-image"
		  />
		</div>

		<div class="class-card-back">
		  <h1>${data.name}</h1>

		  <p>
			<strong>Slots</strong><br>
			${Object.entries(data.slots ?? {})
			  .map(([slot, count]) => `${count} ${slot.charAt(0).toUpperCase() + slot.slice(1)}`)
			  .join("<br>") || "None"}

		  </p>

		  <p><strong>Passive:</strong> ${data.passive ?? "—"}</p>
			<p><strong>Ability:</strong> ${data.ability ?? "—"}</p>

		</div>
	  </div>
	`;


    container.appendChild(div);
    attachSwipeFlip(div);

    div.addEventListener("click", () => {
      if (div.dataset.justSwiped) return;
      startNewGame(data);
    });

  }
}

async function startNewGame(classData) {
	console.log('start game');
  player = {
    ...classData,
    currentHp: classData.hp,
    equipment: {
      weapon: null,
      armor: null,
      any: null
    }
  };

  // Show/hide "any" slot
	const anySlot = document.getElementById("slot-any");
	if (anySlot) {
	  if (player.name.toLowerCase() === "classless") {
		anySlot.style.display = "flex";
	  } else {
		anySlot.style.display = "none";
	  }
	}

  renderPlayerSprite();
  handleKillReward();       // starts first room
  saveGame();
  switchToGame();
  updateUI();
}


function switchToGame() {
  //document.getElementById("classSelect").classList.add("hidden");
  //document.getElementById("gameScreen").classList.add("active");
  //document.getElementById("gameScreen").classList.remove("hidden");
  //document.getElementById("classSelect").classList.remove("active");
  showScreen("gameScreen");
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    player,
    enemy
  }));
}

function loadGame() {
  const data = localStorage.getItem(SAVE_KEY);
  console.log(data);
  if (!data) return false;

  const save = JSON.parse(data);
  player = save.player;
  enemy = save.enemy;

  switchToGame();
  updateUI();
  updateEquipmentUI();
  return true;
}

document.querySelectorAll(".slot").forEach(slot => {
  slot.ondragover = e => e.preventDefault();

  slot.ondrop = e => {
    const handIndex = e.dataTransfer.getData("handIndex");
    const card = hand[handIndex];
    if (!card) return;

    // Validate slot
    const slotType = slot.dataset.slot;
    if (slotType !== "any" && card.type !== slotType) return;

    // Check if something is already equipped
    if (slotType === "weapon" && player.equipment.weapon) {
      if (!confirm(`Replace ${player.equipment.weapon.name}?`)) return;
    }
    if (slotType === "armor" && player.equipment.armor.length > 0) {
      if (!confirm(`Replace ${player.equipment.armor.name}?`)) return;
    }
    if (slotType === "any" && player.equipment.any) {
      if (!confirm(`Replace ${player.equipment.any.name}?`)) return;
    }

    // Equip card
    if (slotType === "weapon") player.equipment.weapon = card;
    if (slotType === "armor") player.equipment.armor = card;
    if (slotType === "any") player.equipment.any = card;

    // Remove from hand
    hand[handIndex] = null;
    renderHand();
    updateUI();
    saveGame();
  };
});
function updateHpBar(kind, current, max) {
  const fill = document.getElementById(kind === "player" ? "playerHpFill" : "monsterHpFill");
  const text = document.getElementById(kind === "player" ? "playerHpText" : "monsterHpText");
  if (!fill || !text) return;

  const safeMax = Math.max(1, max || 0);
  const safeCur = Math.max(0, Math.min(current || 0, safeMax));
  const pct = (safeCur / safeMax) * 100;

  fill.style.width = `${pct}%`;
  text.textContent = `${safeCur}/${safeMax}`;

  // Color thresholds:
  // Green > 51%, Yellow 26–50%, Red <= 25%
  if (pct > 51) fill.style.background = "#2ecc71";
  else if (pct >= 26) fill.style.background = "#f1c40f";
  else fill.style.background = "#e74c3c";
}

function renderEnemy() {
  if (!enemy) return;

  const nameEl  = document.getElementById("monsterName");
  const statsEl = document.getElementById("monsterStats");
  const descEl  = document.getElementById("monsterDesc");

  const spriteNameEl = document.getElementById("monsterSpriteName");

  if (nameEl)  nameEl.textContent  = enemy.name ?? "Monster";
  if (spriteNameEl) spriteNameEl.textContent = enemy.name ?? "Monster";

  // ✅ remove HP from the info-panel stats
  if (statsEl) statsEl.textContent = 
      `ATK ${enemy.attack ?? 0} • HP ${enemy.currentHp ?? 0}/${enemy.hp ?? 0} `;

  if (descEl)  descEl.textContent  = enemy.description ?? "";

  // ✅ update HP bar under sprite
  updateHpBar("monster", enemy.currentHp ?? 0, enemy.hp ?? 0);
}


function renderEquipSlot(el, card, placeholder) {
  if (!el) return;
  el.dataset.placeholder = placeholder;

  if (card) {
    el.classList.remove("empty");
    el.innerHTML = cardToHandHTML(card);
  } else {
    el.classList.add("empty");
    el.innerHTML = "";
  }
}

function renderPlayer() {
  if (!player) return;

  const nameEl    = document.getElementById("playerName");
  const statsEl   = document.getElementById("playerStats");
  const passiveEl = document.getElementById("playerPassive");
  const abilityEl = document.getElementById("playerAbility");

  const totalAtk = getTotalAtk();
  const totalDef = getTotalDef();
  const maxHp = getMaxHp();
  player.currentHp = Math.min(player.currentHp, maxHp);

  if (nameEl)    nameEl.textContent = player.name ?? "Player";
  if (statsEl)   statsEl.textContent = 
    `ATK ${totalAtk} • DEF ${totalDef} • HP ${player.currentHp ?? 0}/${maxHp}`;

  const spriteNameEl = document.getElementById("playerSpriteName");
  if (spriteNameEl) spriteNameEl.textContent = player.name ?? "Player";

  updateHpBar("player", player.currentHp ?? 0, maxHp);
  if (passiveEl) passiveEl.innerHTML = `<span class="desc-label">Passive:</span> ${player.passive ?? "—"}`;
  if (abilityEl) abilityEl.innerHTML = `<span class="desc-label">Ability:</span> ${player.ability ?? "—"}`;

  
   // --- Equipped slots in the player panel (render like hand cards) ---
  const wSlot = document.getElementById("equip-slot-weapon");
  const aSlot = document.getElementById("equip-slot-armor");
  const anySlot = document.getElementById("equip-slot-any");

  const isClassless = (player.name || "").toLowerCase() === "classless";
  if (anySlot) anySlot.style.display = isClassless ? "block" : "none";
  
  const slotsWrap = document.getElementById("equippedSlots");
  if (slotsWrap) slotsWrap.classList.toggle("has-any", isClassless);

  if (anySlot) anySlot.style.display = isClassless ? "flex" : "none";

  renderEquipSlot(wSlot, player.equipment?.weapon, "Weapon");
  renderEquipSlot(aSlot, player.equipment?.armor,  "Armor");
  if (isClassless) {
    renderEquipSlot(anySlot, player.equipment?.any, "Any");
  }
}
function renderPlayerSprite() {
  const el = document.getElementById("playerSprite");
  if (!el || !player) return;

  // uses /images/warrior.png etc
  const file = player.name.toLowerCase();
  el.innerHTML = `<img src="images/${file}.png" alt="${player.name}">`;
}
function renderEnemySprite() {
  const el = document.getElementById("monsterSprite");
  if (!el || !enemy) return;

  // If your creature JSON includes enemy.image, use it.
  // Otherwise fallback to a generic placeholder.
  const src = enemy.image
    ? enemy.image
    : `images/creatures/${(enemy.name || "monster").toLowerCase().replace(/\s+/g,'_')}.png`;

  //const src = `images/creatures/rare_goblin.png`;
  el.innerHTML = `<img src="${src}" alt="${enemy.name}">`;
}


function drawCreature() {
  const roll = Math.random() * 100;

  // Same rates as equips
  const pools =
    roll < 50 ? [decks.creatures_common] :
    roll < 80 ? [decks.creatures_rare, decks.creatures_common] :
    roll < 95 ? [decks.creatures_epic, decks.creatures_rare, decks.creatures_common] :
                [decks.creatures_legendary, decks.creatures_epic, decks.creatures_rare];

  return pickFromPools(pools); // uses your combined+clone version
}

function spawnRandomEnemy() {
  const picked = drawCreature();
  if (!picked) return;

  enemy = picked;             // already cloned by pickFromPools
  enemy.currentHp = enemy.hp;

  renderEnemy();
  renderEnemySprite();
}


function getTotalDef() {
  let totalDef = 0;
  if (player.equipment.armor)  totalDef += player.equipment.armor.armor || 0;
  if (player.equipment.any)    totalDef += player.equipment.any.armor   || 0;
  if (player.equipment.weapon) totalDef += player.equipment.weapon.armor || 0;
  return totalDef;
}

function getTotalAtk() {
  let totalAtk = player.attack;

  if (player.equipment.weapon && player.equipment.weapon.attack) {
    totalAtk += player.equipment.weapon.attack;
  }

  if (player.equipment.armor && player.equipment.armor.attack) {
    totalAtk += player.equipment.armor.attack; // some armors may have attack bonus
  }

  if (player.equipment.any && player.equipment.any.attack) {
    totalAtk += player.equipment.any.attack; // classless any slot
  }

  return totalAtk;
}

function getMaxHp() {
  return (player.hp || 0);
}




init();
