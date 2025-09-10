// index_server.js

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { performance } = require("perf_hooks");
const path = require("path"); // <-- ADDED

const app = express();
// 1. Serve static files like script.js, style.css, etc.
app.use(express.static(__dirname));

// 2. Handle the root route ('/') and serve the main HTML file
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
const server = http.createServer(app);

const { instrument } = require("@socket.io/admin-ui");
const { MsgPackParser } = require("socket.io-msgpack-parser"); // <-- Add import

const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    parser: MsgPackParser, // <-- Add this line
});

// --- PERFORMANCE MONITORING SETUP ---
const PERF_REPORT_INTERVAL = 1000; // Report stats every 1000ms (1 second)
const perfData = {
    totalLoop: [],
    updateCellPositions: [],
    updateEjectedMassPositions: [],
    handleIntraPlayerCollisions: [],
    handlePlayerCellMerging: [],
    handleEating: [],
    emitGameState: [],
    lastReportTime: 0,
};

function reportPerformance() {
    console.log(
        `\n--- Performance Report (last ${PERF_REPORT_INTERVAL}ms) ---`,
    );
    for (const key in perfData) {
        if (Array.isArray(perfData[key]) && perfData[key].length > 0) {
            const timings = perfData[key];
            const sum = timings.reduce((a, b) => a + b, 0);
            const avg = sum / timings.length;
            const max = Math.max(...timings);

            console.log(
                `[${key.padEnd(28)}] Avg: ${avg.toFixed(3)}ms | Max: ${max.toFixed(3)}ms | Samples: ${timings.length}`,
            );

            // Reset for the next interval
            perfData[key] = [];
        }
    }
    console.log("-------------------------------------------\n");
}

// --- CONFIGURATION ---
const CONFIG = {
    PORT: process.env.PORT || 3000,
    SERVER_TICK_RATE: 60,
    WORLD_WIDTH: 5000, //CHANGE 5000
    WORLD_HEIGHT: 5000, //CHANGE 5000
    MAX_CELL_MASS: 40000,
    FOOD_COUNT: 1000, //CHANGE 1000
    PLAYER_START_MASS: 400, //CHANGE 400
    PLAYER_BASE_SPEED: 5,
    PLAYER_SPEED_DECAY_RATE: 0.5,
    FOOD_RADIUS: 5,
    FOOD_MASS: 50, //CHANGE 20
    FOOD_RESPAWN_RATE: 1000,
    EJECTED_MASS_AMOUNT: 20,
    MIN_MASS_TO_EJECT: 200,
    EJECTED_MASS_SPEED: 12,
    EJECTED_MASS_DECELERATION: 0.87,
    EJECTED_MASS_RADIUS: 8,
    EJECTED_MASS_BOUNCINESS: 0.6,
    MIN_RESPAWN_DISTANCE: 100,
    MIN_MASS_TO_SPLIT: 200,
    MAX_CELLS: 8,
    SPLIT_SPEED: 20,
    SPLIT_DECELERATION: 0.92,
    MERGE_TIME_BASE: 15000,
    MERGE_TIME_PER_MASS: 5,
    EAT_MASS_DIFFERENCE: 1.15,
    COLLISION_ITERATIONS: 3,
    GRID_CELL_SIZE: 200,
    VIRUS_COUNT: 10, //CHANGE 20
    VIRUS_MASS: 400,
    VIRUS_MIN_SPAWN_DISTANCE: 100,
    VIRUS_MAX_MASS: 600,
    VIRUS_SPLIT_SPEED: 20,
    VIRUS_SPLIT_DECELERATION: 0.85,
    VIRUS_BOUNCINESS: 0.7,
    VIRUS_EXPLOSION_MAIN_CELL_MASS_RATIO: 0.4,
    VIRUS_EXPLOSION_SPLIT_SPEED: 15,
    DECAY_START_MASS: 1000,
    DECAY_RATE: 0.001,
    DECAY_MASS_FACTOR: 0.000001,
};

const players = {};
let food = [];
let ejectedMasses = [];
let viruses = [];
let lastDecayTime = performance.now();

function getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function spawnSingleFood() {
    if (food.length < CONFIG.FOOD_COUNT) {
        food.push({
            x: Math.random() * CONFIG.WORLD_WIDTH,
            y: Math.random() * CONFIG.WORLD_HEIGHT,
            radius: CONFIG.FOOD_RADIUS,
            color: getRandomColor(),
        });
    }
}

function spawnInitialFood() {
    for (let i = 0; i < CONFIG.FOOD_COUNT; i++) {
        spawnSingleFood();
    }
}

// *** MODIFICATION 1: Update encodeGameState to send skin URL ***
function encodeGameState(players, food, ejectedMasses, viruses) {
    const encodedPlayers = Object.values(players).map((p) => {
        const encodedCells = p.cells.map((c) => [
            c.id,
            Math.round(c.x),
            Math.round(c.y),
            Math.round(c.mass),
        ]);
        return [p.id, p.nickname, p.color, encodedCells, p.skinUrl, p.emote];
        skinUrl;
    });

    // Encode food into: [[x, y, color], ...]
    const encodedFood = food.map((f) => [
        Math.round(f.x),
        Math.round(f.y),
        f.color,
    ]);

    // Encode ejected masses into: [[x, y, radius, color], ...]
    const encodedEjectedMasses = ejectedMasses.map((e) => [
        Math.round(e.x),
        Math.round(e.y),
        e.radius,
        e.color,
    ]);

    // Encode viruses into [[x, y, mass], ...]
    const encodedViruses = viruses.map((v) => [
        Math.round(v.x),
        Math.round(v.y),
        v.mass,
    ]);

    return [encodedPlayers, encodedFood, encodedEjectedMasses, encodedViruses];
}

function getSafeVirusSpawnPosition() {
    let position = {};
    let isSafe = false;
    const maxAttempts = 50; // Prevents an infinite loop
    let attempts = 0;

    const virusRadius = Math.sqrt(CONFIG.VIRUS_MASS);

    while (!isSafe && attempts < maxAttempts) {
        attempts++;
        position = {
            x:
                virusRadius +
                Math.random() * (CONFIG.WORLD_WIDTH - 2 * virusRadius),
            y:
                virusRadius +
                Math.random() * (CONFIG.WORLD_HEIGHT - 2 * virusRadius),
        };
        isSafe = true;

        for (const playerId in players) {
            for (const cell of players[playerId].cells) {
                const dx = position.x - cell.x;
                const dy = position.y - cell.y;
                const distSq = dx * dx + dy * dy;

                const safetyThreshold =
                    CONFIG.VIRUS_MIN_SPAWN_DISTANCE + cell.radius;
                if (distSq < safetyThreshold * safetyThreshold) {
                    isSafe = false;
                    break;
                }
            }
            if (!isSafe) break;
        }
    }
    return isSafe ? position : null; // Return null if no safe spot is found
}

function spawnSingleVirus() {
    if (viruses.length < CONFIG.VIRUS_COUNT) {
        const position = getSafeVirusSpawnPosition();
        if (position) {
            viruses.push({
                x: position.x,
                y: position.y,
                mass: CONFIG.VIRUS_MASS,
                radius: Math.sqrt(CONFIG.VIRUS_MASS),
                vx: 0,
                vy: 0,
            });
        }
    }
}

function spawnInitialViruses() {
    for (let i = 0; i < CONFIG.VIRUS_COUNT; i++) {
        spawnSingleVirus();
    }
}

function updateVirusPositions() {
    for (const virus of viruses) {
        if (virus.vx !== 0 || virus.vy !== 0) {
            virus.x += virus.vx;
            virus.y += virus.vy;
            if (
                virus.x - virus.radius < 0 ||
                virus.x + virus.radius > CONFIG.WORLD_WIDTH
            ) {
                virus.vx *= -CONFIG.VIRUS_BOUNCINESS;
                virus.x = Math.max(
                    virus.radius,
                    Math.min(CONFIG.WORLD_WIDTH - virus.radius, virus.x),
                );
            }
            if (
                virus.y - virus.radius < 0 ||
                virus.y + virus.radius > CONFIG.WORLD_HEIGHT
            ) {
                virus.vy *= -CONFIG.VIRUS_BOUNCINESS;
                virus.y = Math.max(
                    virus.radius,
                    Math.min(CONFIG.WORLD_HEIGHT - virus.radius, virus.y),
                );
            }
            virus.vx *= CONFIG.VIRUS_SPLIT_DECELERATION;
            virus.vy *= CONFIG.VIRUS_SPLIT_DECELERATION;
            if (Math.abs(virus.vx) < 0.1 && Math.abs(virus.vy) < 0.1) {
                virus.vx = 0;
                virus.vy = 0;
            }
        }
    }
}

function enforceCellMassLimits() {
    for (const id in players) {
        const player = players[id];
        const cellsToCheck = [...player.cells];
        for (const cell of cellsToCheck) {
            if (cell.mass > CONFIG.MAX_CELL_MASS) {
                if (player.cells.length >= CONFIG.MAX_CELLS) {
                    cell.mass = CONFIG.MAX_CELL_MASS;
                    continue;
                }
                const originalMass = cell.mass;
                cell.mass = originalMass / 2;
                const newCell = {
                    id: player.nextCellId++,
                    x: cell.x,
                    y: cell.y,
                    mass: originalMass / 2,
                    radius: Math.sqrt(originalMass / 2),
                    vx: 0,
                    vy: CONFIG.SPLIT_SPEED * 0.2,
                    mergeTime:
                        CONFIG.MERGE_TIME_BASE +
                        (originalMass / 2) * CONFIG.MERGE_TIME_PER_MASS,
                };
                cell.mergeTime = newCell.mergeTime;
                player.cells.push(newCell);
            }
        }
    }
}

function applyMassDecay() {
    const MAX_DECAY_RATE = 0.05;

    for (const id in players) {
        const player = players[id];
        for (const cell of player.cells) {
            if (cell.mass > CONFIG.DECAY_START_MASS) {
                let currentDecayRate =
                    CONFIG.DECAY_RATE + cell.mass * CONFIG.DECAY_MASS_FACTOR;

                // Optional: Cap the decay rate
                currentDecayRate = Math.min(currentDecayRate, MAX_DECAY_RATE);

                const massRetentionRatio = 1 - currentDecayRate;
                cell.mass *= massRetentionRatio;

                if (cell.mass < CONFIG.DECAY_START_MASS) {
                    cell.mass = CONFIG.DECAY_START_MASS;
                }
            }
        }
    }
}

function gameLoop() {
    const loopStartTime = performance.now();
    let startTime = performance.now();
    updateCellPositions();
    perfData.updateCellPositions.push(performance.now() - startTime);
    startTime = performance.now();
    updateEjectedMassPositions();
    perfData.updateEjectedMassPositions.push(performance.now() - startTime);
    updateVirusPositions();
    startTime = performance.now();
    handleIntraPlayerCollisions();
    perfData.handleIntraPlayerCollisions.push(performance.now() - startTime);
    startTime = performance.now();
    handlePlayerCellMerging();
    perfData.handlePlayerCellMerging.push(performance.now() - startTime);
    startTime = performance.now();
    handleEating();
    perfData.handleEating.push(performance.now() - startTime);
    enforceCellMassLimits();
    startTime = performance.now();
    const encodedState = encodeGameState(players, food, ejectedMasses, viruses);
    io.emit("gameState", encodedState);
    perfData.emitGameState.push(performance.now() - startTime);
    perfData.totalLoop.push(performance.now() - loopStartTime);
    const now = performance.now();
    if (now - perfData.lastReportTime > PERF_REPORT_INTERVAL) {
        perfData.lastReportTime = now;
    }
}

// *** All functions from updateCellPositions to getSafeSpawnPosition are unchanged. For brevity, I'm omitting them, but they should be present in your file. ***
function updateCellPositions() {
    for (const id in players) {
        const player = players[id];
        for (const cell of player.cells) {
            cell.radius = Math.sqrt(cell.mass);
            const dx = player.targetX - cell.x;
            const dy = player.targetY - cell.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 1) {
                const maxSpeed =
                    CONFIG.PLAYER_BASE_SPEED /
                    Math.pow(cell.radius, CONFIG.PLAYER_SPEED_DECAY_RATE);
                const actualSpeed = maxSpeed;
                const angle = Math.atan2(dy, dx);
                cell.x += Math.cos(angle) * actualSpeed;
                cell.y += Math.sin(angle) * actualSpeed;
            }

            cell.x += cell.vx;
            cell.y += cell.vy;
            cell.vx *= CONFIG.SPLIT_DECELERATION;
            cell.vy *= CONFIG.SPLIT_DECELERATION;
            if (Math.abs(cell.vx) < 0.1 && Math.abs(cell.vy) < 0.1) {
                cell.vx = 0;
                cell.vy = 0;
            }

            cell.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, cell.x));
            cell.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, cell.y));

            if (cell.mergeTime > 0) {
                cell.mergeTime -= 1000 / CONFIG.SERVER_TICK_RATE;
            }
        }
    }
}

function handleIntraPlayerCollisions() {
    for (const id in players) {
        const player = players[id];
        if (player.cells.length <= 1) continue;

        for (let i = 0; i < player.cells.length; i++) {
            for (let j = i + 1; j < player.cells.length; j++) {
                const cellA = player.cells[i];
                const cellB = player.cells[j];

                // Only apply collision physics to cells that cannot merge yet.
                if (cellA.mergeTime > 0 || cellB.mergeTime > 0) {
                    const dx = cellB.x - cellA.x;
                    const dy = cellB.y - cellA.y;
                    const distSq = dx * dx + dy * dy;

                    const sumOfRadii = cellA.radius + cellB.radius;
                    const sumOfRadiiSq = sumOfRadii * sumOfRadii;

                    // Check for collision using squared distances to avoid expensive sqrt operations on every check.
                    if (distSq < sumOfRadiiSq && distSq > 0) {
                        // A collision has been detected. Now we calculate the exact distance to resolve the overlap.
                        const distance = Math.sqrt(distSq);

                        // The amount of overlap that needs to be corrected.
                        const overlap = (sumOfRadii - distance) / 2;

                        // The normalized direction vector from A to B. This is the axis of collision.
                        // We divide by distance to get a "unit vector" of length 1.
                        const nx = dx / distance;
                        const ny = dy / distance;

                        // Move cellA backwards along the collision axis.
                        cellA.x -= nx * overlap;
                        cellA.y -= ny * overlap;

                        // Move cellB forwards along the collision axis.
                        cellB.x += nx * overlap;
                        cellB.y += ny * overlap;

                        // Preserve the boundary checks from the original function.
                        cellA.x = Math.max(
                            0,
                            Math.min(CONFIG.WORLD_WIDTH, cellA.x),
                        );
                        cellA.y = Math.max(
                            0,
                            Math.min(CONFIG.WORLD_HEIGHT, cellA.y),
                        );
                        cellB.x = Math.max(
                            0,
                            Math.min(CONFIG.WORLD_WIDTH, cellB.x),
                        );
                        cellB.y = Math.max(
                            0,
                            Math.min(CONFIG.WORLD_HEIGHT, cellB.y),
                        );
                    }
                }
            }
        }
    }
}

function updateEjectedMassPositions() {
    for (let i = ejectedMasses.length - 1; i >= 0; i--) {
        const pellet = ejectedMasses[i];
        pellet.x += pellet.vx;
        pellet.y += pellet.vy;
        if (
            pellet.x - pellet.radius < 0 ||
            pellet.x + pellet.radius > CONFIG.WORLD_WIDTH
        ) {
            pellet.vx *= -CONFIG.EJECTED_MASS_BOUNCINESS;
            pellet.x = Math.max(
                pellet.radius,
                Math.min(CONFIG.WORLD_WIDTH - pellet.radius, pellet.x),
            );
        }
        if (
            pellet.y - pellet.radius < 0 ||
            pellet.y + pellet.radius > CONFIG.WORLD_HEIGHT
        ) {
            pellet.vy *= -CONFIG.EJECTED_MASS_BOUNCINESS;
            pellet.y = Math.max(
                pellet.radius,
                Math.min(CONFIG.WORLD_HEIGHT - pellet.radius, pellet.y),
            );
        }
        pellet.vx *= CONFIG.EJECTED_MASS_DECELERATION;
        pellet.vy *= CONFIG.EJECTED_MASS_DECELERATION;
        if (Math.abs(pellet.vx) < 0.1 && Math.abs(pellet.vy) < 0.1) {
            pellet.vx = 0;
            pellet.vy = 0;
        }
    }
}

function handlePlayerCellMerging() {
    for (const id in players) {
        const player = players[id];
        if (player.cells.length <= 1) continue;

        const cellsToCheck = [...player.cells];
        for (let i = 0; i < cellsToCheck.length; i++) {
            for (let j = i + 1; j < cellsToCheck.length; j++) {
                const cellA = cellsToCheck[i];
                const cellB = cellsToCheck[j];

                if (
                    !player.cells.includes(cellA) ||
                    !player.cells.includes(cellB)
                )
                    continue;

                if (cellA.mergeTime > 0 || cellB.mergeTime > 0) continue;

                const dx = cellB.x - cellA.x;
                const dy = cellB.y - cellA.y;
                const distSq = dx * dx + dy * dy;

                const bigger = cellA.mass >= cellB.mass ? cellA : cellB;
                const smaller = cellA.mass < cellB.mass ? cellA : cellB;

                const mergeThreshold = bigger.radius - 0.7 * smaller.radius;

                if (
                    mergeThreshold > 0 &&
                    distSq <= mergeThreshold * mergeThreshold
                ) {
                    bigger.mass += smaller.mass;
                    const smallerIndex = player.cells.indexOf(smaller);
                    if (smallerIndex !== -1) {
                        player.cells.splice(smallerIndex, 1);
                    }
                    return handlePlayerCellMerging();
                }
            }
        }
    }
}
function handleEating() {
    // 1. Setup: Create the spatial grid
    const grid = new Map();
    const cellSize = CONFIG.GRID_CELL_SIZE;
    const playerIds = Object.keys(players);

    const getGridKey = (x, y) => {
        const col = Math.floor(x / cellSize);
        const row = Math.floor(y / cellSize);
        return `${col},${row}`;
    };

    const addToGrid = (key, entity) => {
        if (!grid.has(key)) {
            grid.set(key, []);
        }
        grid.get(key).push(entity);
    };

    // 2. Placement (Broad Phase - Part 1): Populate the grid with all entities
    for (const id of playerIds) {
        for (const cell of players[id].cells) {
            addToGrid(getGridKey(cell.x, cell.y), {
                type: "playerCell",
                data: cell,
                ownerId: id,
            });
        }
    }
    for (let i = 0; i < food.length; i++) {
        addToGrid(getGridKey(food[i].x, food[i].y), {
            type: "food",
            data: food[i],
            index: i,
        });
    }
    for (let i = 0; i < ejectedMasses.length; i++) {
        addToGrid(getGridKey(ejectedMasses[i].x, ejectedMasses[i].y), {
            type: "ejectedMass",
            data: ejectedMasses[i],
            index: i,
        });
    }
    for (let i = 0; i < viruses.length; i++) {
        // <-- ADDED: Viruses go into the grid
        addToGrid(getGridKey(viruses[i].x, viruses[i].y), {
            type: "virus",
            data: viruses[i],
            index: i,
        });
    }

    const eatenFoodIndices = new Set();
    const eatenEjectedMassIndices = new Set();
    const eatenPlayerCellIds = new Set(); // Stores "playerId_cellId"
    const eatenVirusIndices = new Set();

    // 3. Checking (Broad Phase - Part 2) & 4. Narrow Phase
    for (const id of playerIds) {
        const player = players[id];
        if (!player) continue;

        for (const cell of player.cells) {
            if (eatenPlayerCellIds.has(`${id}_${cell.id}`)) continue;

            const potentialColliders = [];
            const baseCol = Math.floor(cell.x / cellSize);
            const baseRow = Math.floor(cell.y / cellSize);

            // Gather entities from the 9 relevant grid cells
            for (let r = baseRow - 1; r <= baseRow + 1; r++) {
                for (let c = baseCol - 1; c <= baseCol + 1; c++) {
                    const key = `${c},${r}`;
                    if (grid.has(key)) {
                        potentialColliders.push(...grid.get(key));
                    }
                }
            }

            // Perform precise checks against potential colliders
            for (const other of potentialColliders) {
                if (eatenPlayerCellIds.has(`${id}_${cell.id}`)) break; // Stop if this cell was eaten

                // --- Eating Food and Ejected Mass (without sqrt) ---
                if (
                    other.type === "food" &&
                    !eatenFoodIndices.has(other.index)
                ) {
                    const distSq =
                        (cell.x - other.data.x) ** 2 +
                        (cell.y - other.data.y) ** 2;
                    if (distSq < cell.radius * cell.radius) {
                        cell.mass += CONFIG.FOOD_MASS;
                        eatenFoodIndices.add(other.index);
                    }
                } else if (
                    other.type === "ejectedMass" &&
                    !eatenEjectedMassIndices.has(other.index)
                ) {
                    const distSq =
                        (cell.x - other.data.x) ** 2 +
                        (cell.y - other.data.y) ** 2;
                    if (distSq < cell.radius * cell.radius) {
                        cell.mass += other.data.mass;
                        eatenEjectedMassIndices.add(other.index);
                    }
                }
                // --- Eating Other Player Cells ---
                else if (other.type === "playerCell") {
                    const otherCell = other.data;
                    if (
                        id === other.ownerId ||
                        eatenPlayerCellIds.has(
                            `${other.ownerId}_${otherCell.id}`,
                        )
                    ) {
                        continue;
                    }

                    let bigger, smaller, smallerOwnerId;
                    if (cell.mass > otherCell.mass) {
                        [bigger, smaller, smallerOwnerId] = [
                            cell,
                            otherCell,
                            other.ownerId,
                        ];
                    } else {
                        [bigger, smaller, smallerOwnerId] = [
                            otherCell,
                            cell,
                            id,
                        ];
                    }

                    if (
                        bigger.mass >
                        smaller.mass * CONFIG.EAT_MASS_DIFFERENCE
                    ) {
                        const distSq =
                            (bigger.x - smaller.x) ** 2 +
                            (bigger.y - smaller.y) ** 2;
                        const mergeThreshold =
                            bigger.radius - 0.7 * smaller.radius;

                        if (
                            mergeThreshold > 0 &&
                            distSq <= mergeThreshold * mergeThreshold
                        ) {
                            bigger.mass += smaller.mass;
                            eatenPlayerCellIds.add(
                                `${smallerOwnerId}_${smaller.id}`,
                            );
                        }
                    }
                }

                //Eating virus
                else if (
                    other.type === "virus" &&
                    !eatenVirusIndices.has(other.index)
                ) {
                    const virus = other.data;

                    // Condition 1: Player cell must be significantly larger than the virus
                    if (cell.mass > virus.mass * CONFIG.EAT_MASS_DIFFERENCE) {
                        const distSq =
                            (cell.x - virus.x) ** 2 + (cell.y - virus.y) ** 2;
                        // Using same merge logic as player-vs-player
                        const mergeThreshold = cell.radius - 0.7 * virus.radius;

                        // Condition 2: Virus is mostly inside the player cell
                        if (
                            mergeThreshold > 0 &&
                            distSq <= mergeThreshold * mergeThreshold
                        ) {
                            eatenVirusIndices.add(other.index); // Mark virus for deletion
                            cell.mass += virus.mass; // Absorb virus mass

                            // EXPLOSION LOGIC: Only explode if not at max cells
                            if (player.cells.length < CONFIG.MAX_CELLS) {
                                // --- MODIFICATION START ---

                                // 1. Define the minimum mass for a newly created cell.
                                const MIN_EXPLOSION_CELL_MASS = 100;

                                // 2. Calculate the total mass available to be split into new cells.
                                const massToDistribute =
                                    cell.mass *
                                    (1 -
                                        CONFIG.VIRUS_EXPLOSION_MAIN_CELL_MASS_RATIO);

                                // 3. Determine the maximum number of new cells possible based on TWO constraints.
                                const maxCellsByMass = Math.floor(
                                    massToDistribute / MIN_EXPLOSION_CELL_MASS,
                                );
                                const maxCellsByLimit =
                                    CONFIG.MAX_CELLS - player.cells.length;

                                // The final number of new cells is the SMALLER of the two constraints.
                                const numNewCells = Math.min(
                                    maxCellsByMass,
                                    maxCellsByLimit,
                                );

                                // Only proceed with the split if we can create at least one new cell.
                                if (numNewCells > 0) {
                                    // The original cell keeps its share of the mass.
                                    cell.mass *=
                                        CONFIG.VIRUS_EXPLOSION_MAIN_CELL_MASS_RATIO;

                                    // 1. Calculate the mass that is guaranteed for the new cells.
                                    const guaranteedMass =
                                        numNewCells * MIN_EXPLOSION_CELL_MASS;

                                    // 2. Calculate the "leftover" mass that will be distributed randomly.
                                    const randomMassPool =
                                        massToDistribute - guaranteedMass;

                                    // 3. Generate random weights to distribute the leftover mass.
                                    const newCells = [];
                                    const randomWeights = [];
                                    let totalWeight = 0;
                                    for (let i = 0; i < numNewCells; i++) {
                                        // Adding 1 ensures no weight is zero, preventing division by zero issues
                                        // and making the distribution feel more substantial.
                                        const weight = Math.random() + 1;
                                        randomWeights.push(weight);
                                        totalWeight += weight;
                                    }

                                    // 4. Create the new cells.
                                    for (let i = 0; i < numNewCells; i++) {
                                        // Each cell gets its base minimum mass PLUS its share of the random pool.
                                        const extraMass =
                                            (randomWeights[i] / totalWeight) *
                                            randomMassPool;
                                        const newMass =
                                            MIN_EXPLOSION_CELL_MASS + extraMass;

                                        const angle =
                                            Math.random() * Math.PI * 2;

                                        const newCell = {
                                            id: player.nextCellId++,
                                            x: cell.x,
                                            y: cell.y,
                                            mass: newMass,
                                            radius: Math.sqrt(newMass),
                                            vx:
                                                Math.cos(angle) *
                                                CONFIG.VIRUS_EXPLOSION_SPLIT_SPEED,
                                            vy:
                                                Math.sin(angle) *
                                                CONFIG.VIRUS_EXPLOSION_SPLIT_SPEED,
                                            mergeTime:
                                                CONFIG.MERGE_TIME_BASE +
                                                cell.mass *
                                                    CONFIG.MERGE_TIME_PER_MASS,
                                        };
                                        newCells.push(newCell);
                                    }

                                    // --- MODIFICATION END ---

                                    cell.mergeTime =
                                        CONFIG.MERGE_TIME_BASE +
                                        cell.mass * CONFIG.MERGE_TIME_PER_MASS;

                                    player.cells.push(...newCells);
                                }
                                // If numNewCells is 0, the player simply absorbs the virus mass without exploding.
                                // --- MODIFICATION END ---
                            }
                            // If player is already at max cells, they just gain the mass.
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < ejectedMasses.length; i++) {
        // If this mass was already eaten by a player, skip it.
        if (eatenEjectedMassIndices.has(i)) continue;

        const pellet = ejectedMasses[i];
        const potentialColliders = [];
        const baseCol = Math.floor(pellet.x / cellSize);
        const baseRow = Math.floor(pellet.y / cellSize);

        // Gather entities from 9 relevant grid cells
        for (let r = baseRow - 1; r <= baseRow + 1; r++) {
            for (let c = baseCol - 1; c <= baseCol + 1; c++) {
                const key = `${c},${r}`;
                if (grid.has(key)) potentialColliders.push(...grid.get(key));
            }
        }

        // Check for collision with viruses
        for (const other of potentialColliders) {
            if (other.type === "virus") {
                const virus = other.data;
                const distSq =
                    (pellet.x - virus.x) ** 2 + (pellet.y - virus.y) ** 2;

                // Check if the center of the pellet is inside the virus
                if (distSq < virus.radius * virus.radius) {
                    eatenEjectedMassIndices.add(i); // Mark pellet as eaten
                    virus.mass += pellet.mass;
                    virus.radius = Math.sqrt(virus.mass); // Grow the virus

                    // Check if the virus should split
                    if (virus.mass >= CONFIG.VIRUS_MAX_MASS) {
                        virus.mass = CONFIG.VIRUS_MASS; // Reset original virus
                        virus.radius = Math.sqrt(CONFIG.VIRUS_MASS);

                        // Fire a new virus in the direction the pellet was moving
                        const angle = Math.atan2(pellet.vy, pellet.vx);
                        const newVirus = {
                            x: virus.x,
                            y: virus.y,
                            mass: CONFIG.VIRUS_MASS,
                            radius: Math.sqrt(CONFIG.VIRUS_MASS),
                            vx: Math.cos(angle) * CONFIG.VIRUS_SPLIT_SPEED,
                            vy: Math.sin(angle) * CONFIG.VIRUS_SPLIT_SPEED,
                        };
                        viruses.push(newVirus);
                    }
                    break; // Pellet is eaten, stop checking for this pellet
                }
            }
        }
    }

    // --- Cleanup Phase: Remove all eaten entities after checks are complete ---
    if (eatenFoodIndices.size > 0) {
        food = food.filter((_, i) => !eatenFoodIndices.has(i));
    }
    if (eatenEjectedMassIndices.size > 0) {
        ejectedMasses = ejectedMasses.filter(
            (_, i) => !eatenEjectedMassIndices.has(i),
        );
    }
    if (eatenVirusIndices.size > 0) {
        // <-- ADDED: Remove eaten viruses
        viruses = viruses.filter((_, i) => !eatenVirusIndices.has(i));
    }
    if (eatenPlayerCellIds.size > 0) {
        for (const id of playerIds) {
            if (players[id]) {
                players[id].cells = players[id].cells.filter(
                    (cell) => !eatenPlayerCellIds.has(`${id}_${cell.id}`),
                );
            }
        }
    }

    // Check for player deaths
    for (const id of playerIds) {
        if (players[id] && players[id].cells.length === 0) {
            io.sockets.sockets.get(id)?.emit("playerDied");
            delete players[id];
        }
    }
}
function getSafeSpawnPosition() {
    let position = {};
    let isSafe = false;
    const maxAttempts = 100; // Prevents an infinite loop if the map is crowded
    let attempts = 0;

    const newCellRadius = Math.sqrt(CONFIG.PLAYER_START_MASS);

    while (!isSafe && attempts < maxAttempts) {
        attempts++;
        // Generate a random position, ensuring the new cell is fully within bounds
        position = {
            x:
                newCellRadius +
                Math.random() * (CONFIG.WORLD_WIDTH - 2 * newCellRadius),
            y:
                newCellRadius +
                Math.random() * (CONFIG.WORLD_HEIGHT - 2 * newCellRadius),
        };

        isSafe = true; // Assume the position is safe until a conflict is found

        // If there are no other players, any spot is safe.
        if (Object.keys(players).length === 0) {
            break;
        }

        for (const playerId in players) {
            for (const cell of players[playerId].cells) {
                const dx = position.x - cell.x;
                const dy = position.y - cell.y;
                const distSq = dx * dx + dy * dy;

                // Condition for being UNSAFE (too close):
                // distance < min_respawn_distance + other_cell_radius
                // Squared: distSq < (min_respawn_distance + other_cell_radius)^2
                const safetyThreshold =
                    CONFIG.MIN_RESPAWN_DISTANCE + cell.radius;
                const safetyThresholdSq = safetyThreshold * safetyThreshold;

                if (distSq < safetyThresholdSq) {
                    isSafe = false;
                    break; // This position is unsafe, break from the inner cell loop
                }
            }
            if (!isSafe) {
                break; // Break from the outer player loop to generate a new position
            }
        }
    }

    if (attempts >= maxAttempts) {
        console.warn(
            `Could not find a safe spawn position after ${maxAttempts} attempts.`,
        );
    }
    //position = { x: 2500, y: 2500 }; //uncomment this
    return position;
}

io.on("connection", (socket) => {
    console.log(`Player connected: ${socket.id}`);
    const forwardedFor = socket.handshake.headers["x-forwarded-for"];
    const clientIp = forwardedFor
        ? forwardedFor.split(",")[0].trim()
        : socket.handshake.address;

    console.log(`Player connected: ${socket.id} from IP: ${clientIp}`);
    socket.emit("gameSetup", {
        worldWidth: CONFIG.WORLD_WIDTH,
        worldHeight: CONFIG.WORLD_HEIGHT,
    });

    // *** MODIFICATION 2: Update joinGame handler to accept skinUrl ***
    socket.on("joinGame", (data) => {
        const startPosition = getSafeSpawnPosition();

        players[socket.id] = {
            id: socket.id,
            nickname: data.nickname,
            skinUrl: data.skinUrl || null, // <-- ADDED: Store the skin URL
            color: getRandomColor(),
            cells: [
                {
                    id: 0,
                    x: startPosition.x,
                    y: startPosition.y,
                    mass: CONFIG.PLAYER_START_MASS,
                    radius: Math.sqrt(CONFIG.PLAYER_START_MASS),
                    vx: 0,
                    vy: 0,
                    mergeTime: 0,
                },
            ],
            targetX: startPosition.x,
            targetY: startPosition.y,
            nextCellId: 1,
            // NEW: Add emote-related properties
            lastEmoteTime: 0,
            emote: null,
        };
        console.log(
            `Player ${data.nickname} (${socket.id}) joined with skin: ${data.skinUrl}.`,
        );
        socket.emit("joined", { playerId: socket.id });
    });

    // *** MODIFICATION 3: Add new listener for playing emotes ***
    socket.on("playEmote", ({ emoteId }) => {
        const player = players[socket.id];
        if (!player || player.cells.length === 0) return;

        const now = Date.now();
        // Cooldown check (5 seconds)
        if (now - player.lastEmoteTime < 5000) {
            return;
        }

        player.lastEmoteTime = now;

        // Find the player's largest cell
        let largestCell = player.cells.reduce((largest, current) => {
            return current.mass > largest.mass ? current : largest;
        }, player.cells[0]);

        // Set the emote state (lasts for 3 seconds)
        player.emote = {
            emoteId: emoteId,
            largestCellId: largestCell.id,
        };
        console.log(emoteId + " " + largestCell.id);
        // Clear the emote after 3 seconds
        setTimeout(() => {
            // Make sure player and emote still exist and haven't been replaced
            const currentPlayer = players[socket.id];
            if (
                currentPlayer &&
                currentPlayer.emote &&
                currentPlayer.emote.largestCellId === largestCell.id
            ) {
                currentPlayer.emote = null;
            }
        }, 3000);
    });

    // ... (All other socket event listeners like 'mouseMove', 'ejectMass', etc., are unchanged) ...
    socket.on("mouseMove", (data) => {
        const player = players[socket.id];
        if (player) {
            player.targetX = data.x;
            player.targetY = data.y;
        }
    });

    socket.on("ejectMass", () => {
        const player = players[socket.id];
        if (!player || player.cells.length === 0) return;
        for (const cell of player.cells) {
            if (cell.mass >= CONFIG.MIN_MASS_TO_EJECT) {
                cell.mass -= CONFIG.EJECTED_MASS_AMOUNT - 2; //FARMING
                const angle = Math.atan2(
                    player.targetY - cell.y,
                    player.targetX - cell.x,
                );
                const startX = cell.x + Math.cos(angle) * (cell.radius + 2);
                const startY = cell.y + Math.sin(angle) * (cell.radius + 2);
                ejectedMasses.push({
                    x: startX,
                    y: startY,
                    vx: Math.cos(angle) * CONFIG.EJECTED_MASS_SPEED,
                    vy: Math.sin(angle) * CONFIG.EJECTED_MASS_SPEED,
                    mass: CONFIG.EJECTED_MASS_AMOUNT,
                    radius: CONFIG.EJECTED_MASS_RADIUS,
                    color: player.color,
                });
            }
        }
    });

    socket.on("split", () => {
        const player = players[socket.id];
        if (!player) return;
        const WALL_TOLERANCE = 5;
        const cellsToSplit = [...player.cells];
        for (const cell of cellsToSplit) {
            if (player.cells.length >= CONFIG.MAX_CELLS) break;
            if (cell.mass < CONFIG.MIN_MASS_TO_SPLIT) continue;
            cell.mass /= 2;
            const angle = Math.atan2(
                player.targetY - cell.y,
                player.targetX - cell.x,
            );

            // 1. Calculate the initial intended velocity
            let newVx = Math.cos(angle) * CONFIG.SPLIT_SPEED;
            let newVy = Math.sin(angle) * CONFIG.SPLIT_SPEED;

            // 2. Check for wall collisions and reverse velocity if needed ("bounce")

            // Check horizontal bounce (left and right walls)
            if (
                (cell.x <= WALL_TOLERANCE && newVx < 0) ||
                (cell.x >= CONFIG.WORLD_WIDTH - WALL_TOLERANCE && newVx > 0)
            ) {
                newVx *= -0.7; // Reverse horizontal direction
            }

            // Check vertical bounce (top and bottom walls)
            if (
                (cell.y <= WALL_TOLERANCE && newVy < 0) ||
                (cell.y >= CONFIG.WORLD_HEIGHT - WALL_TOLERANCE && newVy > 0)
            ) {
                newVy *= -0.7; // Reverse vertical direction
            }

            // 3. Create the new cell with the potentially adjusted velocity
            const newCell = {
                id: player.nextCellId++,
                x: cell.x,
                y: cell.y,
                mass: cell.mass,
                radius: Math.sqrt(cell.mass),
                vx: newVx, // Use the adjusted velocity
                vy: newVy, // Use the adjusted velocity
                mergeTime:
                    CONFIG.MERGE_TIME_BASE +
                    cell.mass * CONFIG.MERGE_TIME_PER_MASS,
            };
            cell.mergeTime = newCell.mergeTime;
            player.cells.push(newCell);
        }
    });
    socket.on("disconnect", () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
    });
});

const chatIo = io.of("/chat");

chatIo.on("connection", (socket) => {
    console.log(`A user connected to chat: ${socket.id}`);
    socket.on("joinChat", (data) => {
        socket.nickname = data.nickname;
        socket.gameId = data.gameId;
        console.log(
            `${socket.nickname} (GameID: ${socket.gameId}) joined the chat.`,
        );
    });
    socket.on("sendMessage", (message) => {
        const player = players[socket.gameId];
        if (socket.nickname && player) {
            console.log(`Message from ${socket.nickname}: ${message}`);
            chatIo.emit("newMessage", {
                nickname: socket.nickname,
                message: message,
                color: player.color,
            });
        }
    });
    socket.on("disconnect", () => {
        if (socket.nickname) {
            console.log(`${socket.nickname} left the chat.`);
        }
    });
});

io.on("connection", (socket) => {});

spawnInitialFood();
spawnInitialViruses();
setInterval(gameLoop, 1000 / CONFIG.SERVER_TICK_RATE);
setInterval(spawnSingleFood, CONFIG.FOOD_RESPAWN_RATE);
setInterval(spawnSingleVirus, 3000);
setInterval(applyMassDecay, 1000);

server.listen(CONFIG.PORT, () =>
    console.log(`Server listening on port ${CONFIG.PORT}`),
);
