// script.js with Client-Side Interpolation and Corrected View Scaling

// --- HTML ELEMENTS ---
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const startMenu = document.getElementById("startMenu");
const nicknameInput = document.getElementById("nicknameInput");
const playButton = document.getElementById("playButton");
const spectateButton = document.getElementById("spectateButton");

const chatArea = document.getElementById("chat-area");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const toggleChatBtn = document.getElementById("toggle-chat-btn");
const toggleSkinsBtn = document.getElementById("toggle-skins-btn");

const skinPreview = document.getElementById("skinPreview");
const skinInput = document.getElementById("skinInput");
const uploadSkinButton = document.getElementById("uploadSkinButton");
const skinUrlInput = document.getElementById("skinUrlInput");

// --- SERVER CONNECTION ---
const SERVER_URL = window.location.origin;

const socket = io(SERVER_URL);
let chatSocket = null;

// --- GAME STATE & CONFIG ---
let players = {};
let food = [];
let ejectedMasses = [];
let myPlayerId = null;
let world = { width: 0, height: 0 };
let isGameReadyToDraw = false;
const INTERPOLATION_SPEED = 0.2;
let ejectInterval = null;
let skinsVisible = true;

let playerSkins = {}; // Cache for loaded skin images { playerId: Image }
let selectedSkinFile = null; // Holds the file selected by the user

// NEW: Spectator mode state variables
let isSpectating = false;
let spectatedPlayerId = null;
let spectatePlayerList = [];
let spectateIndex = 0;
let spectateUpdateInterval = null;

// NEW: This object will store the camera's world-coordinate boundaries each frame.
let viewport = { left: 0, right: 0, top: 0, bottom: 0 };
// NEW: An extra margin to prevent objects from "popping" in at the very edge.
const CULLING_MARGIN = 100; // in pixels
let drawnEntitiesThisFrame = 0;
let totalEntitiesInView = 0;
let lastLogTime = 0;
const LOG_INTERVAL = 1000; // Log to console every 1000ms (1 second)

// NEW: Emote Configuration
const EMOTE_SCALE_FACTOR = 1.3;
const EMOTE_URLS = {
    1: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/lottie.json", // 😀
    2: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/lottie.json", // 😂
    3: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f621/lottie.json", // 😡
    4: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f634/lottie.json", // 😴
    5: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f4a9/lottie.json", // 💩
    6: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/lottie.json", // 👍
    7: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/lottie.json", // 🔥
    8: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f480/lottie.json", // 💀
    9: "https://fonts.gstatic.com/s/e/notoemoji/latest/1f92c/lottie.json", // 🤬
};
let emoteCooldown = false;
const emoteRendererPool = {};
let playerActiveEmotes = {};

const virusImage = new Image();
virusImage.src = "virus.png";

const dealership = new Image();
dealership.src = "dealership.png";
let showdealershipImage = true;
const DEALERSHIP_IMAGE_CONFIG = {
    x: 3976,
    y: 3976,
    width: 1024,
    height: 1024,
};

const curry = new Image();
curry.src = "curry.png";
let showcurryImage = true;
const CURRY_IMAGE_CONFIG = {
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
};

// *** MODIFIED: Corrected and Clarified Zoom Configuration ***
const ZOOM_SPEED = 0.07; // How fast the mouse wheel changes the zoom multiplier.
const ZOOM_SMOOTH_SPEED = 0.15; // How smoothly the camera interpolates to the target zoom.

// --- TWEAK THESE VALUES ---
const VIEW_SCALE = 3; // The base magnification. 2.0 means everything is 2x bigger by default.
const MAX_ZOOM_IN_MULTIPLIER = 2.0; // Max manual zoom IN (Total zoom = VIEW_SCALE * this value).
const MIN_ZOOM_OUT_MULTIPLIER = 0.1; // An absolute limit on how far the game can zoom OUT.

// The camera's zoom is now a multiplier on top of VIEW_SCALE.
const camera = {
    x: 0,
    y: 0,
    zoom: 1.0, // Start with a 1x multiplier
    targetZoom: 1.0,
    lastMinZoom: 1.0,
};

// --- MINIMAP CONFIG ---
const MINIMAP_ENABLED = true;
const MINIMAP_SIZE = 200; // The width and height of the minimap in pixels
const MINIMAP_MARGIN = 20; // The distance from the bottom-right corner of the screen
const MINIMAP_GRID_DIVISIONS = 5; // The number of rows/columns in the grid
const MINIMAP_BACKGROUND_COLOR = "rgba(50, 50, 50, 0.6)";
const MINIMAP_GRID_COLOR = "rgba(255, 255, 255, 0.3)";
const MINIMAP_HIGHLIGHT_COLOR = "rgba(150, 150, 0, 0.4)"; // The color for the active grid sector
const MINIMAP_BORDER_COLOR = "#FFFFFF";
const MINIMAP_FONT_COLOR = "rgba(255, 255, 255, 0.7)";
const MINIMAP_FONT = "14px Arial";

// Store the last known MOUSE SCREEN position, not world position.
let mouseScreenPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// --- CANVAS SETUP ---
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    mouseScreenPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
});

function isObjectVisible(obj) {
    const objRight = obj.x + obj.radius;
    const objLeft = obj.x - obj.radius;
    const objBottom = obj.y + obj.radius;
    const objTop = obj.y - obj.radius;

    // This checks for intersection. It's faster than checking if it's "inside".
    // The object is NOT visible if it's completely to the left, right, top, or bottom.
    if (
        objRight < viewport.left ||
        objLeft > viewport.right ||
        objBottom < viewport.top ||
        objTop > viewport.bottom
    ) {
        return false;
    }
    return true;
}

async function preloadEmotes() {
    console.log("Starting emote pre-rendering...");
    const masterContainer = document.getElementById("emote-preload-container");

    for (const id in EMOTE_URLS) {
        if (emoteRendererPool[id]) continue; // Skip if already pre-rendered

        // Create a dedicated container for this specific emote
        const emoteContainer = document.createElement("div");
        emoteContainer.style.width = "512px";
        emoteContainer.style.height = "512px";
        masterContainer.appendChild(emoteContainer);

        const anim = lottie.loadAnimation({
            container: emoteContainer,
            renderer: "canvas",
            loop: true,
            autoplay: false, // We will control playback manually
            path: EMOTE_URLS[id],
        });

        // Use a promise to wait for the animation to be fully ready
        await new Promise((resolve) => {
            anim.addEventListener("DOMLoaded", () => {
                const lottieCanvas = emoteContainer.querySelector("canvas");
                // Store the fully prepared renderer object in our pool
                emoteRendererPool[id] = {
                    animation: anim,
                    sourceCanvas: lottieCanvas,
                };
                anim.pause(); // Pause it immediately to save resources
                console.log(
                    `Successfully pre-rendered and pooled emote ${id}.`,
                );
                resolve();
            });
        });
    }
    console.log("Emote pre-rendering complete.");
}

function upload_image_promise(imgBlob) {
    return new Promise((resolve, reject) => {
        let cloud_url = "https://api.cloudinary.com/v1_1/dfrhv4fhm/upload";
        let preset = "ptr7pmx1";

        var formData = new FormData();
        formData.append("file", imgBlob);
        formData.append("upload_preset", preset);

        addChatMessage({ nickname: "System", message: "Uploading skin..." });

        axios({
            url: cloud_url,
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: formData,
        })
            .then(function (res) {
                if (res.data.url) {
                    addChatMessage({
                        nickname: "System",
                        message: "Skin uploaded successfully!",
                    });
                    skinUrlInput.value = res.data.url;
                    resolve(res.data.url);
                } else {
                    reject("Upload failed: No URL returned.");
                }
            })
            .catch(function (err) {
                console.error("Image upload failed:", err);
                addChatMessage({
                    nickname: "System",
                    message: "Skin upload failed.",
                });
                reject(err);
            });
    });
}

function upload_image(imgBlob) {
    let cloud_url = "https://api.cloudinary.com/v1_1/dfrhv4fhm/upload";
    let preset = "ptr7pmx1";

    var formData = new FormData();
    formData.append("file", imgBlob);
    formData.append("upload_preset", preset);

    // Show a temporary message
    addChatMessage({ nickname: "System", message: "Uploading image..." });

    axios({
        url: cloud_url,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: formData,
    })
        .then(function (res) {
            // Instead of putting it in a textarea, send the URL through the chat socket
            if (res.data.url && chatSocket) {
                chatSocket.emit("sendMessage", res.data.url);
            }
        })
        .catch(function (err) {
            console.error("Image upload failed:", err);
            addChatMessage({
                nickname: "System",
                message: "Image upload failed.",
            });
        });
}

function addChatMessage(data) {
    const item = document.createElement("li");

    // Regular expression to check if a message is an image URL
    const isImageUrl = /\.(jpeg|jpg|gif|png)$/i.test(data.message);

    // Add the nickname first, unless it's an image from the current user
    // because the URL will be sent separately.
    const nicknameStrong = document.createElement("strong");
    nicknameStrong.textContent = `${data.nickname}: `;
    if (data.color) {
        nicknameStrong.style.color = data.color;
    }
    item.appendChild(nicknameStrong);

    if (isImageUrl) {
        const img = document.createElement("img");
        img.src = data.message;
        img.className = "chat-image"; // Apply our CSS style
        item.appendChild(img);
    } else {
        const messageText = document.createTextNode(data.message);
        item.appendChild(messageText);
    }

    chatMessages.appendChild(item);

    // Auto-scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatInput.addEventListener("paste", (event) => {
    // Get the items from the clipboard
    const items = (event.clipboardData || window.clipboardData).items;

    // Loop through all items, looking for any that are images
    for (let i = 0; i < items.length; i++) {
        // Skip any items that are not files
        if (items[i].kind === "file" && items[i].type.startsWith("image/")) {
            // We found an image!
            event.preventDefault(); // Prevent the default paste action
            const imageFile = items[i].getAsFile(); // Get the image as a file
            upload_image(imageFile); // Call our upload function
            return; // Stop after handling the first image
        }
    }
});

// --- SOCKET.IO EVENT LISTENERS ---
socket.on("connect", () => {
    console.log("Connected to the server!");
    myPlayerId = socket.id;
});

socket.on("gameSetup", (setup) => {
    world.width = setup.worldWidth;
    world.height = setup.worldHeight;
});

socket.on("playerDied", () => {
    startMenu.style.display = "block";
    chatArea.classList.add("d-none");
    isGameReadyToDraw = false;
    players = {};
    playerSkins = {};
    // *** MODIFIED: Reset zoom multiplier to 1.0 on death ***
    camera.zoom = 1.0;
    camera.targetZoom = 1.0;
    camera.lastMinZoom = 1.0;
    if (chatSocket) {
        chatSocket.disconnect();
        chatSocket = null;
    }
});

// --- GAME LOGIC & RENDERING ---

function gameLoop() {
    updatePositions();
    updateCamera();
    updateAndApplyZoom();
    draw();
    requestAnimationFrame(gameLoop);
}

function updateAndApplyZoom() {
    // Determine the correct player to base the zoom on
    const targetPlayerId = isSpectating ? spectatedPlayerId : myPlayerId;
    const targetPlayer = players[targetPlayerId];

    let dynamicMinZoomMultiplier = 1.0;

    if (targetPlayer && targetPlayer.cells.length > 0) {
        const totalMass = targetPlayer.cells.reduce(
            (sum, cell) => sum + cell.mass,
            0,
        );
        const numCells = targetPlayer.cells.length;
        const equivalentRadius = Math.sqrt(totalMass);
        const viewFactor = 1 + Math.sqrt(equivalentRadius) * 0.08;
        const splitBonusDiminisher = 1 / (1 + equivalentRadius * 0.005);
        const splitFactor = 1 + (numCells - 1) * 0.1 * splitBonusDiminisher;
        dynamicMinZoomMultiplier = 1.0 / (viewFactor * splitFactor);
    }

    if (isSpectating) {
        dynamicMinZoomMultiplier *= 0.6;
    }

    // Enforce the absolute minimum multiplier.
    dynamicMinZoomMultiplier = Math.max(
        dynamicMinZoomMultiplier,
        MIN_ZOOM_OUT_MULTIPLIER,
    );

    // --- REVISED LOGIC START ---

    // Condition 1: Was the player at the absolute max zoom-out on the previous frame?
    // We use a small tolerance to account for floating point inaccuracies.
    const wasAtMaxZoomOut = camera.targetZoom <= camera.lastMinZoom + 0.001;

    // Condition 2: Is the new zoom limit even further out than the old one?
    const newLimitIsFurther = dynamicMinZoomMultiplier < camera.lastMinZoom;

    // Only if both conditions are true, we automatically adjust the target zoom.
    if (wasAtMaxZoomOut && newLimitIsFurther) {
        camera.targetZoom = dynamicMinZoomMultiplier;
    }

    // --- REVISED LOGIC END ---

    // This single line correctly clamps the target zoom multiplier.
    // It can't go below the dynamic minimum, and it can't go above the manual maximum.
    camera.targetZoom = Math.max(
        dynamicMinZoomMultiplier,
        Math.min(camera.targetZoom, MAX_ZOOM_IN_MULTIPLIER),
    );

    // Smoothly interpolate the actual zoom towards the (now correctly clamped) target.
    camera.zoom += (camera.targetZoom - camera.zoom) * ZOOM_SMOOTH_SPEED;

    // Store this frame's minimum for the next frame's comparison.
    camera.lastMinZoom = dynamicMinZoomMultiplier;
}

function draw() {
    drawnEntitiesThisFrame = 0;
    totalEntitiesInView = 0;

    if (!isGameReadyToDraw && !isSpectating) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return; // Stop the function here
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // --- MODIFICATION START ---

    // Calculate the final scale for this frame
    const finalScale = VIEW_SCALE * camera.zoom;

    // Update the global viewport object with the current visible boundaries
    const viewWidth = canvas.width / finalScale;
    const viewHeight = canvas.height / finalScale;

    viewport.left = camera.x - viewWidth / 2 - CULLING_MARGIN;
    viewport.right = camera.x + viewWidth / 2 + CULLING_MARGIN;
    viewport.top = camera.y - viewHeight / 2 - CULLING_MARGIN;
    viewport.bottom = camera.y + viewHeight / 2 + CULLING_MARGIN;

    // --- MODIFICATION END ---

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(finalScale, finalScale);
    ctx.translate(-camera.x, -camera.y);

    drawWorldBoundary();
    drawDealershipImage();
    drawCurryImage();
    drawAllFood();
    //drawAllViruses();
    drawAllEjectedMass();

    drawGameEntities();

    ctx.restore();
    drawUI();

    /*
    // NEW: Log the final counts periodically
    const now = performance.now();
    if (now - lastLogTime > LOG_INTERVAL) {
        console.log(
            `Rendering: ${drawnEntitiesThisFrame} / ${totalEntitiesInView} objects (Culled ${totalEntitiesInView - drawnEntitiesThisFrame})`,
        );
        lastLogTime = now;
    }*/
}

function stopSpectating() {
    isSpectating = false;
    spectatedPlayerId = null;
    if (spectateUpdateInterval) {
        clearInterval(spectateUpdateInterval); // CRITICAL: Stop the interval
        spectateUpdateInterval = null;
    }
    startMenu.style.display = "block";
}

// NEW: Function to update the spectator list
function updateSpectateList() {
    if (!isSpectating || Object.keys(players).length === 0) {
        return;
    }

    // Get the ID of the player we are currently watching
    const currentSpectatedId = spectatePlayerList[spectateIndex] || null;

    // Create the new, up-to-date sorted list of player IDs
    const newSortedList = Object.values(players)
        .map((p) => ({
            id: p.id,
            totalMass: p.cells.reduce((sum, cell) => sum + cell.mass, 0),
        }))
        .filter((p) => p.totalMass > 0)
        .sort((a, b) => b.totalMass - a.totalMass)
        .map((p) => p.id);

    if (newSortedList.length === 0) {
        stopSpectating(); // If no players are left, exit spectator mode
        return;
    }

    spectatePlayerList = newSortedList;

    // Find the new index of the player we were watching
    const newIndex = spectatePlayerList.indexOf(currentSpectatedId);

    if (newIndex !== -1) {
        // The player is still in the list, update our index to their new position
        spectateIndex = newIndex;
    } else {
        // The player we were watching is gone, or we weren't watching anyone.
        // Default to watching the new leader.
        spectateIndex = 0;
    }
    // Finally, update the spectatedPlayerId for the camera to follow
    spectatedPlayerId = spectatePlayerList[spectateIndex];
}

// --- PLAYER INPUT ---
playButton.addEventListener("click", async () => {
    const nickname = nicknameInput.value;
    if (nickname) {
        document.body.classList.remove("initial-load");
        playButton.disabled = true; // Prevent double-clicking
        playButton.textContent = "Joining...";

        let skinUrl = skinUrlInput.value.trim();
        if (!skinUrl && selectedSkinFile) {
            try {
                // upload_image_promise will now populate the input field for us
                skinUrl = await upload_image_promise(selectedSkinFile);
            } catch (error) {
                console.error(
                    "Could not upload skin, proceeding without it.",
                    error,
                );
                skinUrl = null; // Ensure we proceed without a skin on failure
            }
        }

        if (skinUrl === "") {
            skinUrl = null;
        }

        startMenu.style.display = "none";
        preloadEmotes();
        // *** MODIFIED: Reset zoom multiplier to 1.0 on game start ***
        camera.zoom = 1.0;
        camera.targetZoom = 1.0;
        camera.lastMinZoom = 1.0;

        socket.emit("joinGame", { nickname: nickname, skinUrl: skinUrl });
        requestAnimationFrame(gameLoop);

        chatArea.style.display = "flex"; // Show the chat box
        chatArea.classList.remove("d-none");
        toggleChatBtn.textContent = "Hide Chat";

        playButton.disabled = false;
        playButton.textContent = "Play";

        // Connect to the chat namespace
        chatSocket = io(SERVER_URL + "/chat");
        console.log(SERVER_URL + "/chat");
        // Once connected, join the chat with our nickname
        chatSocket.on("connect", () => {
            console.log("Connected to chat namespace!");
            chatSocket.emit("joinChat", {
                nickname: nickname,
                gameId: myPlayerId, // myPlayerId holds the game socket ID
            });
        });

        // Listen for new messages from the server
        chatSocket.on("newMessage", (data) => {
            addChatMessage(data);
        });

        setInterval(() => {
            if (!isSpectating && players[myPlayerId]) {
                const screenCenterX = canvas.width / 2;
                const screenCenterY = canvas.height / 2;
                const dx = mouseScreenPos.x - screenCenterX;
                const dy = mouseScreenPos.y - screenCenterY;

                // *** MODIFIED: Use the final combined scale for coordinate correction ***
                const finalScale = VIEW_SCALE * camera.zoom;
                const dynamicTarget = {
                    x: camera.x + dx / finalScale,
                    y: camera.y + dy / finalScale,
                };

                socket.emit("mouseMove", dynamicTarget);
            }
        }, 50);
    }
});

// NEW: Spectate button listener
spectateButton.addEventListener("click", () => {
    isSpectating = true;

    // Perform an initial update to populate the list immediately
    updateSpectateList();

    // If there are no players after the initial update, don't start spectating
    if (spectatePlayerList.length === 0) {
        alert("No players to spectate!");
        isSpectating = false;
        return;
    }

    // Start the interval to keep the list updated every second
    spectateUpdateInterval = setInterval(updateSpectateList, 1000);

    // --- (Camera snapping logic) ---
    const initialSpectatedPlayer = players[spectatedPlayerId];
    if (initialSpectatedPlayer && initialSpectatedPlayer.cells.length > 0) {
        let totalMass = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (const cell of initialSpectatedPlayer.cells) {
            totalMass += cell.mass;
            weightedX += cell.x * cell.mass;
            weightedY += cell.y * cell.mass;
        }
        if (totalMass > 0) {
            camera.x = weightedX / totalMass;
            camera.y = weightedY / totalMass;
        }
    }

    // Hide menu and start the game loop
    document.body.classList.remove("initial-load");
    startMenu.style.display = "none";
    chatArea.style.display = "none";
    chatArea.classList.add("d-none");
    preloadEmotes();
    camera.zoom = 1.0;
    camera.targetZoom = 1.0;
    camera.lastMinZoom = 1.0;
    requestAnimationFrame(gameLoop);
});

chatForm.addEventListener("submit", (event) => {
    event.preventDefault(); // Prevent page reload
    if (chatInput.value && chatSocket) {
        chatSocket.emit("sendMessage", chatInput.value);
        chatInput.value = ""; // Clear the input field
    }
});

// *** MODIFIED: Mouse wheel adjusts the target zoom MULTIPLIER ***
window.addEventListener(
    "wheel",
    (event) => {
        event.preventDefault();
        if (startMenu.style.display === "block") return;

        const zoomFactor = 1 - Math.sign(event.deltaY) * ZOOM_SPEED;
        camera.targetZoom *= zoomFactor;
    },
    { passive: false },
);

// --- (Copying all unchanged functions for completeness) ---

socket.on("gameState", (encodedState) => {
    const [encodedPlayers, encodedFood, encodedEjectedMasses, encodedViruses] =
        encodedState;

    // 1. Decode and reconstruct food objects
    food = encodedFood.map((f) => ({
        x: f[0],
        y: f[1],
        color: f[2],
        radius: 5, // From server config
    }));

    // 2. Decode and reconstruct ejected mass objects
    ejectedMasses = encodedEjectedMasses.map((e) => ({
        x: e[0],
        y: e[1],
        radius: e[2],
        color: e[3],
    }));

    // 3. Decode players and merge with existing data for interpolation
    const serverPlayers = {};
    for (const pData of encodedPlayers) {
        const [id, nickname, color, cellsData, skinUrl, emote] = pData;
        serverPlayers[id] = {
            id: id,
            nickname: nickname,
            color: color,
            skinUrl: skinUrl,
            emote: emote,
            cells: cellsData.map((cData) => {
                const mass = cData[3];
                return {
                    id: cData[0],
                    x: cData[1],
                    y: cData[2],
                    mass: mass,
                    radius: Math.sqrt(mass), // Re-calculate radius on client
                };
            }),
        };
    }

    // 4. Decode viruses
    viruses = encodedViruses.map((v) => {
        const mass = v[2];
        return {
            x: v[0],
            y: v[1],
            mass: mass,
            radius: Math.sqrt(mass) + 5, // Calculate radius from mass
        };
    });

    // This part is the original interpolation logic, now using the decoded 'serverPlayers'
    const serverPlayerIds = new Set(Object.keys(serverPlayers));

    for (const id in serverPlayers) {
        const serverPlayer = serverPlayers[id];
        if (!players[id]) {
            // New player
            if (id === myPlayerId && serverPlayer.cells.length > 0) {
                const myStartCell = serverPlayer.cells[0];
                camera.x = myStartCell.x;
                camera.y = myStartCell.y;
                isGameReadyToDraw = true;
                console.log(
                    `Camera snapped to initial position: (${camera.x}, ${camera.y})`,
                );
            }
            players[id] = serverPlayer;
            // Initialize serverX/Y for interpolation
            players[id].cells.forEach((cell) => {
                cell.serverX = cell.x;
                cell.serverY = cell.y;
            });
        } else {
            // Existing player
            const localPlayer = players[id];
            // --- NEW: EMOTE MANAGEMENT LOGIC ---
            const serverEmote = serverPlayer.emote;
            const localEmote = localPlayer.emote;

            // If an emote has just started
            if (serverEmote && !localEmote) {
                const emoteId = serverEmote.emoteId;
                // Check if the emote is available in our pool
                if (emoteRendererPool[emoteId]) {
                    // Assign the pre-rendered object to the active player
                    playerActiveEmotes[id] = emoteRendererPool[emoteId];
                    // Start the animation from the beginning
                    playerActiveEmotes[id].animation.goToAndPlay(0, true);
                }
            }
            // If an emote has ended
            else if (!serverEmote && localEmote) {
                if (playerActiveEmotes[id]) {
                    // Pause the animation and remove it from the active list
                    playerActiveEmotes[id].animation.pause();
                    delete playerActiveEmotes[id];
                }
            }

            // This logic no longer needs to create/destroy anything.
            // Just update the player's state.
            localPlayer.emote = serverPlayer.emote;
            // --- END EMOTE MANAGEMENT ---

            localPlayer.nickname = serverPlayer.nickname;
            localPlayer.color = serverPlayer.color;
            localPlayer.skinUrl = serverPlayer.skinUrl;
            localPlayer.emote = serverPlayer.emote;

            const serverCellIds = new Set(serverPlayer.cells.map((c) => c.id));

            for (const serverCell of serverPlayer.cells) {
                let localCell = localPlayer.cells.find(
                    (c) => c.id === serverCell.id,
                );
                if (!localCell) {
                    // New cell for existing player
                    localPlayer.cells.push({
                        ...serverCell,
                        serverX: serverCell.x,
                        serverY: serverCell.y,
                    });
                } else {
                    // Update existing cell for interpolation
                    localCell.serverX = serverCell.x;
                    localCell.serverY = serverCell.y;
                    localCell.radius = serverCell.radius;
                    localCell.mass = serverCell.mass;
                }
            }
            // Remove eaten/merged cells
            localPlayer.cells = localPlayer.cells.filter((c) =>
                serverCellIds.has(c.id),
            );
        }

        // NEW: Asynchronously load skin if it's new or changed
        if (
            serverPlayer.skinUrl &&
            (!playerSkins[id] || playerSkins[id].src !== serverPlayer.skinUrl)
        ) {
            // Check if it's my player's skin
            if (id === myPlayerId) {
                console.log(
                    `[DEBUG] My skin URL received: ${serverPlayer.skinUrl}`,
                );
            }

            const skinImg = new Image();

            // Crucial for debugging CORS issues if your image host is different
            skinImg.crossOrigin = "Anonymous";

            // Log when loading is successful
            skinImg.onload = () => {
                console.log(
                    `[SUCCESS] Skin for player ${id} loaded successfully!`,
                );
                playerSkins[id] = skinImg;
            };

            // Log when loading fails
            skinImg.onerror = () => {
                console.error(
                    `[ERROR] Failed to load skin for player ${id} from URL: ${serverPlayer.skinUrl}`,
                );
                delete playerSkins[id]; // Remove the failed image
            };

            // Start loading the image
            skinImg.src = serverPlayer.skinUrl;

            // Temporarily put a placeholder to prevent re-triggering the load every frame
            playerSkins[id] = skinImg;
        } else if (!serverPlayer.skinUrl && playerSkins[id]) {
            delete playerSkins[id];
        }
    }

    // Remove disconnected players
    for (const id in players) {
        if (!serverPlayerIds.has(id)) {
            // MODIFIED: Clean up emote renderer AND container on disconnect
            if (playerActiveEmotes[id]) {
                playerActiveEmotes[id].animation.pause();
                delete playerActiveEmotes[id];
            }
            delete players[id];
            delete playerSkins[id];
        }
    }
});

function updatePositions() {
    for (const id in players) {
        const player = players[id];
        for (const cell of player.cells) {
            if (cell.serverX !== undefined) {
                cell.x += (cell.serverX - cell.x) * INTERPOLATION_SPEED;
                cell.y += (cell.serverY - cell.y) * INTERPOLATION_SPEED;
            }
        }
    }
}
function updateCamera() {
    const targetPlayerId = isSpectating ? spectatedPlayerId : myPlayerId;
    const myPlayer = players[targetPlayerId];
    if (myPlayer && myPlayer.cells.length > 0) {
        let totalMass = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (const cell of myPlayer.cells) {
            totalMass += cell.mass;
            weightedX += cell.x * cell.mass;
            weightedY += cell.y * cell.mass;
        }
        if (totalMass > 0) {
            const centerX = weightedX / totalMass;
            const centerY = weightedY / totalMass;
            camera.x += (centerX - camera.x) * INTERPOLATION_SPEED;
            camera.y += (centerY - camera.y) * INTERPOLATION_SPEED;
        }
    }
}
function drawUI() {
    // NEW: If spectating, show a different UI element
    if (isSpectating) {
        const spectatedPlayer = players[spectatedPlayerId];
        if (spectatedPlayer) {
            ctx.fillStyle = "#000000";
            ctx.font = "20px Arial";
            ctx.textAlign = "left";
            ctx.fillText(`Spectating: ${spectatedPlayer.nickname}`, 10, 30);
            ctx.fillText(`Press 'Q' to cycle, 'Esc' to exit.`, 10, 55);
        }
        // Always draw leaderboard and minimap when spectating
        const sortedPlayers = Object.values(players)
            .map((p) => ({
                id: p.id,
                nickname: p.nickname,
                totalMass: p.cells.reduce((sum, cell) => sum + cell.mass, 0),
            }))
            .filter((p) => p.totalMass > 0)
            .sort((a, b) => b.totalMass - a.totalMass);
        drawLeaderboard(sortedPlayers);
        if (MINIMAP_ENABLED) {
            drawMinimap();
        }
        return; // End here to not draw player-specific stats
    }

    const myPlayer = players[myPlayerId];
    if (!myPlayer || myPlayer.cells.length === 0) return;
    const myTotalMass = myPlayer.cells.reduce(
        (sum, cell) => sum + cell.mass,
        0,
    );
    const sortedPlayers = Object.values(players)
        .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            totalMass: p.cells.reduce((sum, cell) => sum + cell.mass, 0),
        }))
        .filter((p) => p.totalMass > 0)
        .sort((a, b) => b.totalMass - a.totalMass);
    drawPlayerStats(myPlayer, myTotalMass, sortedPlayers);
    drawLeaderboard(sortedPlayers);

    // *** ADD THIS LINE ***
    if (MINIMAP_ENABLED) {
        drawMinimap();
    }
}

function drawDealershipImage() {
    if (
        showdealershipImage &&
        dealership.complete &&
        dealership.naturalHeight !== 0
    ) {
        ctx.drawImage(
            dealership,
            DEALERSHIP_IMAGE_CONFIG.x,
            DEALERSHIP_IMAGE_CONFIG.y,
            DEALERSHIP_IMAGE_CONFIG.width,
            DEALERSHIP_IMAGE_CONFIG.height,
        );
    }
}

function drawCurryImage() {
    if (showdealershipImage && curry.complete && curry.naturalHeight !== 0) {
        ctx.drawImage(
            curry,
            CURRY_IMAGE_CONFIG.x,
            CURRY_IMAGE_CONFIG.y,
            CURRY_IMAGE_CONFIG.width,
            CURRY_IMAGE_CONFIG.height,
        );
    }
}

function getCurrentGridSector() {
    // Make sure we have the necessary data before calculating
    if (world.width === 0 || world.height === 0) {
        return null;
    }

    const letters = "ABCDE"; // Must match MINIMAP_GRID_DIVISIONS

    // Use the camera's position to determine the grid sector
    const playerGridCol = Math.floor(
        (camera.x / world.width) * MINIMAP_GRID_DIVISIONS,
    );
    const playerGridRow = Math.floor(
        (camera.y / world.height) * MINIMAP_GRID_DIVISIONS,
    );

    // Clamp values to be within the grid bounds (0 to 4 for 5 divisions)
    const clampedCol = Math.max(
        0,
        Math.min(playerGridCol, MINIMAP_GRID_DIVISIONS - 1),
    );
    const clampedRow = Math.max(
        0,
        Math.min(playerGridRow, MINIMAP_GRID_DIVISIONS - 1),
    );

    // Construct the grid label (e.g., "C2")
    return letters[clampedRow] + (clampedCol + 1);
}

function drawMinimap() {
    const targetPlayerId = isSpectating ? spectatedPlayerId : myPlayerId;
    const targetPlayer = players[targetPlayerId];

    // Don't draw if we don't have a valid player or world data yet
    if (!targetPlayer || targetPlayer.cells.length === 0 || world.width === 0) {
        return;
    }

    // --- 1. CALCULATE POSITION & DIMENSIONS ---
    const mapX = canvas.width - MINIMAP_SIZE - MINIMAP_MARGIN;
    const mapY = canvas.height - MINIMAP_SIZE - MINIMAP_MARGIN;
    const gridSize = MINIMAP_SIZE / MINIMAP_GRID_DIVISIONS;
    const letters = "ABCDE"; // For grid labels

    // --- 2. DRAW BACKGROUND & BORDER ---
    ctx.fillStyle = MINIMAP_BACKGROUND_COLOR;
    ctx.fillRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE);

    // --- 3. DRAW GRID & LABELS ---
    ctx.strokeStyle = MINIMAP_GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = MINIMAP_FONT_COLOR;
    ctx.font = MINIMAP_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let row = 0; row < MINIMAP_GRID_DIVISIONS; row++) {
        for (let col = 0; col < MINIMAP_GRID_DIVISIONS; col++) {
            const gridCellX = mapX + col * gridSize;
            const gridCellY = mapY + row * gridSize;

            // Draw grid lines (simplified to just drawing rects)
            ctx.strokeRect(gridCellX, gridCellY, gridSize, gridSize);

            // Draw labels
            const label = letters[row] + (col + 1);
            ctx.fillText(
                label,
                gridCellX + gridSize / 2,
                gridCellY + gridSize / 2,
            );
        }
    }

    // --- 4. HIGHLIGHT PLAYER'S CURRENT GRID SECTOR ---
    // The camera position is the center of the player's view
    const gridSectorLabel = getCurrentGridSector();
    if (gridSectorLabel) {
        // We need to parse the label back to get row/col for drawing
        const row = "ABCDE".indexOf(gridSectorLabel.charAt(0));
        const col = parseInt(gridSectorLabel.substring(1), 10) - 1;

        const highlightX = mapX + col * gridSize;
        const highlightY = mapY + row * gridSize;

        ctx.fillStyle = MINIMAP_HIGHLIGHT_COLOR;
        ctx.fillRect(highlightX, highlightY, gridSize, gridSize);
    }

    // --- 5. DRAW PLAYER'S CELLS ON THE MINIMAP ---
    ctx.fillStyle = targetPlayer.color;
    for (const cell of targetPlayer.cells) {
        // Convert world coordinates to minimap coordinates
        const minimapCellX = mapX + (cell.x / world.width) * MINIMAP_SIZE;
        const minimapCellY = mapY + (cell.y / world.height) * MINIMAP_SIZE;

        // Convert world radius to minimap radius (ensure it's at least 1 pixel)
        const minimapCellRadius = Math.max(
            1,
            (cell.radius / world.width) * MINIMAP_SIZE,
        );

        ctx.beginPath();
        ctx.arc(minimapCellX, minimapCellY, minimapCellRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- 6. DRAW FINAL BORDER ---
    ctx.strokeStyle = MINIMAP_BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE);
}

// script.js (Relevant part to be edited)

function drawPlayerStats(myPlayer, myTotalMass, sortedPlayers) {
    const myRank = sortedPlayers.findIndex((p) => p.id === myPlayerId) + 1;
    const rankText = myRank > 0 ? `Position: ${myRank}` : "Position: N/A";

    // --- MODIFIED SECTION START ---

    // Define box properties for easier calculations
    const statsBoxX = 10;
    const statsBoxY = 10;
    const statsBoxWidth = 220;
    const statsBoxHeight = 80;

    // Draw the background box
    ctx.fillStyle = "rgba(50, 50, 50, 0.4)";
    ctx.fillRect(statsBoxX, statsBoxY, statsBoxWidth, statsBoxHeight);

    // Set text properties
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "20px Arial";

    // Set text alignment to center for proper positioning
    ctx.textAlign = "left";

    // Calculate the horizontal center of the box
    const centerX = statsBoxX + 20;

    // Draw the text at the calculated center
    ctx.fillText("Mass: " + Math.floor(myTotalMass), centerX, 40);
    ctx.fillText(rankText, centerX, 65);

    // --- MODIFIED SECTION END ---
}
function drawLeaderboard(sortedPlayers) {
    const leaderBoardX = canvas.width - 260;
    const leaderBoardY = 10;
    const leaderboardWidth = 250;
    const displayCount = Math.min(sortedPlayers.length, 10);
    const leaderboardHeight = 70 + displayCount * 25;
    ctx.fillStyle = "rgba(50, 50, 50, 0.4)";
    ctx.fillRect(
        leaderBoardX,
        leaderBoardY,
        leaderboardWidth,
        leaderboardHeight,
    );
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "22px Arial";
    ctx.textAlign = "center";
    ctx.fillText(
        "LEADERBOARD",
        leaderBoardX + leaderboardWidth / 2,
        leaderBoardY + 30,
    );
    ctx.font = "18px Arial";
    ctx.textAlign = "left";
    for (let i = 0; i < displayCount; i++) {
        const player = sortedPlayers[i];
        const rank = i + 1;
        const name = player.nickname;
        const text = `${rank}) ${name}`;
        ctx.fillStyle = player.id === myPlayerId ? "#FFFF00" : "#FFFFFF";
        ctx.fillText(text, leaderBoardX + 15, leaderBoardY + 40 + rank * 25);
    }
}
function drawWorldBoundary() {
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, world.width, world.height);
}
function drawAllFood() {
    totalEntitiesInView += food.length;
    for (const f of food) {
        if (!isObjectVisible(f)) continue;
        drawnEntitiesThisFrame++;
        drawCircle(f.x, f.y, f.radius, f.color);
    }
}
function drawAllEjectedMass() {
    totalEntitiesInView += ejectedMasses.length;
    for (const pellet of ejectedMasses) {
        if (!isObjectVisible(pellet)) continue;
        drawnEntitiesThisFrame++;
        drawCircle(pellet.x, pellet.y, pellet.radius, pellet.color);
    }
}

function drawCircle(x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.closePath();
}
function drawPlayerName(x, y, name, radius) {
    const fontSize = Math.max(16, Math.floor(radius / 4));
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = Math.max(1, fontSize / 8);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(name, x, y);
    ctx.fillText(name, x, y);
}

function drawCell(cell, color, skinImage, ownerId) {
    const x = cell.x;
    const y = cell.y;
    const radius = cell.radius;

    const player = players[ownerId];
    const activeEmote = playerActiveEmotes[ownerId];

    // --- MODIFIED: Emote Drawing Logic ---
    // Check if an emote should be playing on this specific cell
    if (
        player &&
        player.emote &&
        player.emote.largestCellId === cell.id &&
        activeEmote
    ) {
        // We no longer need a loading state because the emote is always ready
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.clip();

        const emoteSize = radius * 2 * EMOTE_SCALE_FACTOR;
        const emoteX = x - emoteSize / 2;
        const emoteY = y - emoteSize / 2;

        ctx.drawImage(
            activeEmote.sourceCanvas,
            emoteX,
            emoteY,
            emoteSize,
            emoteSize,
        );

        ctx.restore();
        return; // Stop here to not draw the regular skin/color
    }
    // --- END: Emote Drawing Logic ---

    // Draw the border first
    /*
    const borderWidth = Math.max(2, radius * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, radius + borderWidth, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();*/

    // Check if a skin should be drawn
    const canDrawSkin =
        skinsVisible &&
        skinImage &&
        skinImage.complete &&
        skinImage.naturalHeight !== 0;

    if (canDrawSkin) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.clip(); // Create a circular clipping path
        ctx.drawImage(
            skinImage,
            x - radius,
            y - radius,
            radius * 2,
            radius * 2,
        );
        ctx.restore(); // Remove the clipping path
    } else {
        // Fallback to solid color if no skin
        drawCircle(x, y, radius, color);
    }
}

function drawVirus(x, y, radius) {
    // Ensure the image is loaded before trying to draw it
    if (virusImage.complete && virusImage.naturalHeight !== 0) {
        ctx.save();
        // The image is drawn from its top-left corner, so we offset by the radius
        ctx.drawImage(
            virusImage,
            x - radius,
            y - radius,
            radius * 2,
            radius * 2,
        );
        ctx.restore();
    } else {
        // Fallback to a green circle if the image hasn't loaded
        drawCircle(x, y, radius, "#77DD77"); // A classic virus green
    }
}

function drawAllViruses() {
    for (const v of viruses) {
        drawVirus(v.x, v.y, v.radius);
    }
}

// Listener for the new chat toggle button
toggleChatBtn.addEventListener("click", () => {
    const isHidden = chatArea.classList.toggle("d-none");
    toggleChatBtn.textContent = isHidden ? "Show Chat" : "Hide Chat";
});

// Listener for the new skins toggle button
toggleSkinsBtn.addEventListener("click", () => {
    skinsVisible = !skinsVisible; // Toggle the state

    // Update button appearance and text for feedback
    if (skinsVisible) {
        toggleSkinsBtn.textContent = "Skins On";
        toggleSkinsBtn.classList.remove("active");
    } else {
        toggleSkinsBtn.textContent = "Skins Off";
        toggleSkinsBtn.classList.add("active");
    }
});

function drawGameEntities() {
    // 1. Create a combined list of all renderable entities (player cells and viruses)
    const entities = [];

    // Add player cells to the list
    for (const id in players) {
        for (const cell of players[id].cells) {
            entities.push({
                type: "playerCell", // Add a type identifier
                ...cell,
                ownerId: players[id].id,
                color: players[id].color,
                nickname: players[id].nickname,
            });
        }
    }

    // Add viruses to the list
    for (const virus of viruses) {
        entities.push({
            type: "virus", // Add a type identifier
            ...virus,
        });
    }

    // 2. Sort the combined list by mass in ascending order.
    // This is the key step: smaller objects will be drawn first (in the background).
    entities.sort((a, b) => a.mass - b.mass);
    totalEntitiesInView += entities.length;

    // 3. Loop through the sorted list and draw each entity based on its type
    for (const entity of entities) {
        if (!isObjectVisible(entity)) continue;
        drawnEntitiesThisFrame++;
        if (entity.type === "playerCell") {
            //drawCircle(entity.x, entity.y, entity.radius, entity.color);
            const skinImage = playerSkins[entity.ownerId];
            drawCell(entity, entity.color, skinImage, entity.ownerId);
            const player = players[entity.ownerId];

            if (
                player &&
                (!player.emote || player.emote.largestCellId !== entity.id)
            ) {
                drawPlayerName(
                    entity.x,
                    entity.y,
                    entity.nickname,
                    entity.radius,
                );
            }
        } else if (entity.type === "virus") {
            drawVirus(entity.x, entity.y, entity.radius);
        }
    }
}

window.addEventListener("mousemove", (event) => {
    mouseScreenPos.x = event.clientX;
    mouseScreenPos.y = event.clientY;
});
canvas.addEventListener("mousedown", () => {
    chatArea.classList.add("noselect");
});

// When the user releases the mouse button anywhere, make the chat selectable again.
// We use 'window' to catch the event even if the mouse is released outside the canvas.
window.addEventListener("mouseup", () => {
    chatArea.classList.remove("noselect");
});
canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();

    // Ensure the game is running and the chat is connected
    if (startMenu.style.display !== "none" || !chatSocket) {
        return;
    }

    const gridSector = getCurrentGridSector();

    // If we successfully got a grid sector, format and send the message
    if (gridSector) {
        const message = `my position ${gridSector}`;
        chatSocket.emit("sendMessage", message);
    }
});

window.addEventListener("keydown", (event) => {
    // NEW: Handle spectating controls first
    if (isSpectating) {
        if (event.key.toLowerCase() === "q") {
            if (spectatePlayerList.length > 0) {
                // Cycle to the next player in the (always current) list
                spectateIndex = (spectateIndex + 1) % spectatePlayerList.length;
                spectatedPlayerId = spectatePlayerList[spectateIndex];
                console.log(
                    spectatePlayerList.length + " " + spectatedPlayerId,
                );
            }
        } else if (event.key === "Escape") {
            // Use our new cleanup function
            stopSpectating();
        }
        return; // Prevent any other key actions while spectating
    }
    if (event.key === "Enter" && document.activeElement !== chatInput) {
        event.preventDefault();
        chatInput.focus();
        return;
    }
    if (document.activeElement === chatInput) {
        return;
    }
    // --- NEW: Emote Key Handling ---
    const keyNum = parseInt(event.key);
    if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
        event.preventDefault();
        if (!emoteCooldown) {
            socket.emit("playEmote", { emoteId: keyNum });
            // Set client-side cooldown to prevent spamming server
            console.log("emoite");
            emoteCooldown = true;
            setTimeout(() => {
                emoteCooldown = false;
            }, 5000);
        }
        return; // Don't process other keys if it was an emote key
    }
    // --- END: Emote Key Handling ---

    if (startMenu.style.display === "block") return;
    if (event.key.toLowerCase() === "w" && !event.repeat) {
        socket.emit("ejectMass");
    }
    if (event.code === "Space") {
        event.preventDefault();
        socket.emit("split");
    }
    if (event.key.toLowerCase() === "e") {
        if (!ejectInterval) {
            ejectInterval = setInterval(() => socket.emit("ejectMass"), 80);
        }
    }
});
window.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "e") {
        clearInterval(ejectInterval);
        ejectInterval = null;
    }
});

// NEW: Event listener for the "Upload Skin" button
uploadSkinButton.addEventListener("click", () => {
    skinInput.click(); // Trigger the hidden file input
});

// NEW: Event listener for when a file is selected
skinInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
        selectedSkinFile = file; // Store the file for later upload
        skinPreview.src = URL.createObjectURL(file); // Create a temporary URL for preview
        skinPreview.style.display = "block"; // Show the preview
        skinUrlInput.value = ""; // Clear the URL input to prioritize the file upload
    }
});

preloadEmotes();
