let player, enemy, decks = {};
const SAVE_KEY = "dungeonSave";
const classFiles = [
  "characters/warrior.json",
  "characters/rogue.json",
  "characters/mage.json",
  "characters/classless.json"
];
const HAND_SIZE = 2;
let hand = [];

function drawHand() {
  hand = [];

  // Combine Equips + Consumables
  const combinedDeck = [...decks.equips, ...decks.consumables];

  for (let i = 0; i < HAND_SIZE; i++) {
    const card = combinedDeck[Math.floor(Math.random() * combinedDeck.length)];
    hand.push(card);
  }

  renderHand();
}

function renderEquipment() {
  const slots = ["weapon", "armor", "any"]; // all possible slots

  slots.forEach(slot => {
    const slotEl = document.getElementById(`slot-${slot}`);
    if (!slotEl) return; // skip if the slot doesn't exist (e.g., non-classless no "any")

    const card = player.equipment[slot];

    if (card) {
      // Calculate stats
      const statText = card.attack ? `${card.attack} Atk` :
                       card.armor ? `${card.armor} Def` : "";

      // Replace slot content with card info (each on its own line)
      slotEl.innerHTML = `
        <div class="card-name">${card.name}</div>
        <div class="stat">${statText}</div>
        <div class="description">${card.description.replace(/\n/g,'<br>')}</div>
      `;
    } else {
      // Slot empty, show default label
      slotEl.innerHTML = slot.charAt(0).toUpperCase() + slot.slice(1); // Weapon / Armor / Any
    }
  });
}





// 1️⃣ Define handleCardClick first
function handleCardClick(idx) {
  const card = hand[idx];
  if (!card) return;

  // Consumable cards
  if (card.type === "consumable") {
    if (confirm(`Use ${card.name}?`)) {
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
  if (currentCard !== null && currentCard !== undefined) {
    // Slot occupied, confirm replacement
    confirmMsg = `Replace ${currentCard.name} with ${card.name}?`;
  } else {
    // Slot empty, confirm equip
    confirmMsg = `Are you sure you want to equip ${card.name}?`;
  }

  // Ask for confirmation
  if (!confirm(confirmMsg)) return;

  // Equip card
  player.equipment[slot] = card;
  hand.splice(idx, 1);

	renderHand();
	renderEquipment();
	renderPlayer(); // <--- update attack/HP immediately
	updateUI();
	saveGame();
}





// 2️⃣ Then define renderHand
function renderHand() {
  const handEl = document.getElementById("hand");
  handEl.innerHTML = "";

  hand.forEach((card, idx) => {
    const div = document.createElement("div");
    div.className = "hand-card";
    div.innerHTML = `
      <strong>${card.name}</strong><br>
      <span class="stat">${card.attack || card.armor || card.heal || card.damage || ""}</span><br>
      <em class="description">${card.description}</em>
    `;

    div.onclick = () => handleCardClick(idx);
    handEl.appendChild(div);
  });
}
function applyConsumable(card) {
  if (card.heal) {
    player.currentHp += card.heal;
    const maxHp = player.hp + getArmorHpBonus();
    if (player.currentHp > maxHp) player.currentHp = maxHp;
  }
  // Add other effects if needed: damage, buffs, etc.
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
  return fetch(path).then(r => r.json());
}

async function init() {
	console.log('init');
  decks.equips = await loadJSON("decks/equips.json");
  decks.consumables = await loadJSON("decks/consumables.json");
  decks.creatures = await loadJSON("decks/creatures.json");

  if (!loadGame()) {
    showClassSelect();
  }
  document.getElementById("resetGame").addEventListener("click", () => {
	  if (confirm("Are you sure you want to reset the game?")) {
		// Clear saved state
		localStorage.removeItem("dungeonSave");

		// Hide game screen, show class selection
		document.getElementById("game").classList.add("hidden");
		document.getElementById("classSelect").classList.remove("hidden");

		// Clear visuals **safely**
		const handEl = document.getElementById("hand");
		if (handEl) handEl.innerHTML = "";

		const playerEl = document.getElementById("player");
		if (playerEl) playerEl.innerText = "";

		const enemyEl = document.getElementById("enemy");
		if (enemyEl) enemyEl.innerText = "";

		// Show class selection cards
		showClassSelect();
	  }
	});
	document.getElementById("attackBtn").addEventListener("click", () => {
	  attack();
	});

}
function drawHandForRoom() {

  // Combine equip + consumable decks
  const playableCards = [...decks.equips, ...decks.consumables];

  // Pick 1 random card
  const card = playableCards[Math.floor(Math.random() * playableCards.length)];
  hand.push(card);

  renderHand();
  enableConsumableClick();
}

function nextEnemy() {
  spawnRandomEnemy();
  drawCard();
  updateUI();

  // Only show discard overlay if hand has more than 2 cards
  if (hand.filter(Boolean).length > 2) { // ignore nulls
    showDiscardOverlay();
  } else {
    document.getElementById("discard-overlay").classList.add("hidden");
  }
}

function showDiscardOverlay() {
  const overlay = document.getElementById("discard-overlay");
  const discardHand = document.getElementById("discard-hand");
  discardHand.innerHTML = "";

  const actualCards = hand.filter(Boolean);

  if (actualCards.length <= 2) {
    overlay.classList.add("hidden"); // hide overlay if 2 or less
    return;
  }

  overlay.classList.remove("hidden");

  actualCards.forEach((card, idx) => {
    const div = document.createElement("div");
    div.className = "hand-card";
    div.innerHTML = `
      <strong>${card.name}</strong><br>
      <span class="stat">${card.attack || card.armor || card.heal || card.damage || ""}</span><br>
      <em class="description">${card.description}</em>
    `;

    div.onclick = () => {
      if (confirm(`Discard ${card.name}?`)) {
        const realIndex = hand.indexOf(card);
        if (realIndex !== -1) hand.splice(realIndex, 1);
        renderHand();
        showDiscardOverlay(); // refresh overlay
      }
    };

    discardHand.appendChild(div);
  });
}




function attack() {  
	const totalDmg = getTotalAtk();

  enemy.currentHp -= totalDmg;
  if (enemy.currentHp < 0) enemy.currentHp = 0;

  renderEnemy();
  updateUI();
  saveGame();

  if (enemy.currentHp === 0) {
    alert(`${enemy.name} defeated!`);
    nextEnemy(); // new enemy + draw 1 card, discard extras if needed
  } else {
    enemyAttack();
  }
}


function drawCard() {
  // Combine decks
  const playableCards = [...decks.equips, ...decks.consumables];

  // Pick 1 random card
  const card = playableCards[Math.floor(Math.random() * playableCards.length)];

  hand.push(card); // add to existing hand
  renderHand();
}




function getArmorHpBonus() {
  let bonus = 0;

  // Weapon slot doesn’t give HP bonus, only armor and any slot
  if (player.equipment.armor) {
    bonus += player.equipment.armor.armor || 0;
  }

  if (player.equipment.any) {
    bonus += player.equipment.any.armor || 0; // only if classless any slot has armor
  }

  return bonus;
}



function enemyAttack() {
  const enemyDmg = enemy.attack;
  player.currentHp -= enemyDmg;
  if (player.currentHp < 0) player.currentHp = 0;

  updateUI();
  if (player.currentHp === 0) {
    alert("You died!");
    resetGame();
  }
}


function drawReward() {
  const card = decks.equips[Math.floor(Math.random() * decks.equips.length)];
  renderLoot(card);
}

function equipCard() {
  const card = decks.equips[Math.floor(Math.random() * decks.equips.length)];

  if (card.type === "weapon") {
    // Weapon slot
    if (!player.equipment.weapon) {
      player.equipment.weapon = card;
      return;
    }
    // Any slot
    if (player.slots.any && !player.equipment.any) {
      player.equipment.any = card;
      return;
    }
  }

  if (card.type === "armor") {
    // Armor slot
    if (player.equipment.armor.length < player.slots.armor) {
      player.equipment.armor.push(card);
      return;
    }
    // Any slot
    if (player.slots.any && !player.equipment.any) {
      player.equipment.any = card;
      return;
    }
  }

  // Otherwise: discard (slot full)
}


function useConsumable() {
  const c = decks.consumables[Math.floor(Math.random() * decks.consumables.length)];
  if (c.heal) player.currentHp = Math.min(player.hp, player.currentHp + c.heal);
}

function updateUI() {
  const maxHp = player.hp + getArmorHpBonus();
  player.currentHp = Math.min(player.currentHp, maxHp);

  // Player stats (text-only is fine)
   renderPlayer();

  // Enemy card (needs HTML)
  renderEnemy();
  
  renderHand();
}

function animate(id) {
  const el = document.getElementById(id);
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 300);
}

function renderLoot(card) {
  const loot = document.getElementById("loot");
  loot.innerHTML = "";

  const div = document.createElement("div");
  div.className = "card loot";
  div.innerText = card.name;
  div.draggable = true;

  div.ondragstart = e => {
    e.dataTransfer.setData("card", JSON.stringify(card));
  };

  loot.appendChild(div);
}

function equipToSlot(card, targetSlot) {
  // Validate
  if (targetSlot !== "any" && card.type !== targetSlot) return;

  // Swap logic
  if (targetSlot === "weapon") {
    player.equipment.weapon = card;
  }

  if (targetSlot === "armor") {
    if (player.equipment.armor.length < player.slots.armor) {
      player.equipment.armor.push(card);
    } else {
      player.equipment.armor[0] = card; // swap oldest
    }
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

    if (s === "armor" && player.equipment.armor.length) {
      slot.innerText = player.equipment.armor.map(a => a.name).join(", ");
      slot.classList.add("filled");
    }

    if (s === "any" && player.equipment.any) {
      slot.innerText = player.equipment.any.name;
      slot.classList.add("filled");
    }
  });
}

async function showClassSelect() {
	console.log("Loading classes:", classFiles);
  const container = document.getElementById("classes");
  container.innerHTML = "";

  for (const file of classFiles) {
    const data = await loadJSON(file);

    const div = document.createElement("div");
    div.className = "class-card";
    div.innerHTML = `
      <h3>${data.name}</h3>
      <p>HP: ${data.hp}</p>
      <p>Attack: ${data.attack}</p>
      <p>Slots: ${JSON.stringify(data.slots)}</p>
    `;

    div.onclick = () => startNewGame(data);

    container.appendChild(div);
  }
}

function startNewGame(classData) {
  player = {
    ...classData,
    currentHp: classData.hp,
    equipment: {
      weapon: null,
      armor: [],
      any: null
    }
  };

  // Show/hide "any" slot
  const anySlot = document.getElementById('slot-any');
  if (player.name.toLowerCase() === "classless") {
    anySlot.style.display = "flex";  // show slot
  } else {
    anySlot.style.display = "none";  // hide slot
  }

  nextEnemy();       // starts first room
  saveGame();
  switchToGame();
  updateUI();
}


function switchToGame() {
  document.getElementById("classSelect").classList.add("hidden");
  document.getElementById("game").classList.remove("hidden");
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    player,
    enemy
  }));
}

function loadGame() {
  const data = localStorage.getItem(SAVE_KEY);
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
      if (!confirm(`Replace ${player.equipment.armor[0].name}?`)) return;
    }
    if (slotType === "any" && player.equipment.any) {
      if (!confirm(`Replace ${player.equipment.any.name}?`)) return;
    }

    // Equip card
    if (slotType === "weapon") player.equipment.weapon = card;
    if (slotType === "armor") player.equipment.armor = [card];
    if (slotType === "any") player.equipment.any = card;

    // Remove from hand
    hand[handIndex] = null;
    renderHand();
    updateUI();
    saveGame();
  };
});

function renderEnemy() {
  const enemyEl = document.getElementById("enemy");

  enemyEl.innerHTML = `
    <strong>${enemy.name}</strong><br>
    <span class="stat">${enemy.attack} Atk / ${enemy.currentHp} HP</span><br>
    <em class="description">${enemy.description}</em>
  `;
}
function renderPlayer() {
  const playerEl = document.getElementById("player");
  const totalAtk = getTotalAtk();
  const maxHp = getMaxHp();
  player.currentHp = Math.min(player.currentHp, maxHp);

  playerEl.innerHTML = `
    <strong>${player.name}</strong><br>
    <span class="stat">${totalAtk} Atk / ${player.currentHp} HP</span><br>
    <em class="description">Passive: ${player.passive || "None"}</em><br>
    <em class="description">Ability: ${player.ability || "None"}</em>
  `;
}


function spawnRandomEnemy() {
  // Pick random creature
  enemy = JSON.parse(JSON.stringify(
    decks.creatures[Math.floor(Math.random() * decks.creatures.length)]
  ));

  enemy.currentHp = enemy.hp;
  renderEnemy();
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
  let maxHp = player.hp;

  if (player.equipment.armor && player.equipment.armor.armor) {
    maxHp += player.equipment.armor.armor;
  }

  if (player.equipment.any && player.equipment.any.armor) {
    maxHp += player.equipment.any.armor; // classless any slot
  }

  return maxHp;
}



init();
