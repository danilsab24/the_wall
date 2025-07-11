// DragAndDrop.js - VERSIONE CORRETTA
import * as THREE from 'https://esm.sh/three@0.150.1';
import { Wall } from './wall.js';
import { House } from './village.js';
import { StrongBlock } from './StrongBlock.js';

function setupDragAndDrop({ scene, camera, renderer, grid, controls, getGameState }) {

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const cellSize = grid.size / grid.divisions;
    const halfCells = grid.divisions / 2;

    let dragging = false;
    let dragObject = null;
    let currentPos = null;
    let lastSnappedX = 0;
    let lastSnappedZ = 0;

    const heightMap = new Map();
    const mapKey = (ix, iz) => `${ix}_${iz}`;
    const worldToIx = x => Math.floor(x / cellSize);
    const worldToIz = z => Math.floor(z / cellSize);

    function cellSnap(worldCoord, span) {
        if (span % 2 === 1) {
            // Per blocchi 1x1: aggancia il centro al centro della cella
            const index = Math.floor(worldCoord / cellSize);
            return index * cellSize + (cellSize / 2);
        } else {
            // Per blocchi 2x2: aggancia il centro all'incrocio delle linee della griglia
            const index = Math.round(worldCoord / cellSize);
            return index * cellSize;
        }
    }
    
    function getSpans(obj) {
        if (obj.userData?.type?.startsWith('house')) return { sx: 2, sz: 2 };
        if (obj.userData?.type === 'cube' || obj.userData?.type === 'strong') return { sx: 1, sz: 1 };
        return { sx: 1, sz: 1 };
    }
    
    function cellsCovered(ix0, iz0, sx, sz) {
        const startX = ix0 - Math.floor(sx / 2);
        const startZ = iz0 - Math.floor(sz / 2);
        const cells = [];
        for (let dx = 0; dx < sx; dx++) {
            for (let dz = 0; dz < sz; dz++) {
                cells.push({ ix: startX + dx, iz: startZ + dz });
            }
        }
        return cells;
    }
    
    function updateHeightMapFromScene() {
        heightMap.clear();
        scene.traverse(obj => {
            if (!obj.userData?.isWall && !obj.userData?.isHouse && !obj.userData?.isStrongBlock) return;

            const spans = getSpans(obj);
            const ix0 = worldToIx(obj.position.x);
            const iz0 = worldToIz(obj.position.z);
            const covered = cellsCovered(ix0, iz0, spans.sx, spans.sz);
            
            const box = new THREE.Box3().setFromObject(obj);
            const size = new THREE.Vector3();
            box.getSize(size);
            const topH = obj.position.y + size.y / 2;

            let topType = 'ground';
            if (obj.userData.isHouse) topType = 'house';
            else if (obj.userData.isStrongBlock) topType = 'strong';
            else if (obj.userData.isWall) topType = 'wall';

            covered.forEach(({ ix, iz }) => {
                heightMap.set(mapKey(ix, iz), { top: topType, h: topH });
            });
        });
    }

    function canPlace(cells, objType) {
        let baseHeight = null;
        const supportSurfaces = [];

        for (const { ix, iz } of cells) {
            if (ix < -halfCells || ix >= halfCells || iz < -halfCells || iz >= halfCells) return null;

            const entry = heightMap.get(mapKey(ix, iz));
            const surfaceType = entry?.top ?? 'ground';
            const surfaceHeight = entry?.h ?? 0;
            
            // Se una qualsiasi delle celle che vogliamo occupare è già di tipo 'house',
            // il posizionamento non è valido. Questo impedisce sia di costruire sopra una casa,
            // sia di compenetrarla.
            if (surfaceType === 'house') return null;

            if (baseHeight === null) {
                baseHeight = surfaceHeight;
            } else if (Math.abs(surfaceHeight - baseHeight) > 0.01) {
                return null;
            }
            
            supportSurfaces.push(surfaceType);
        }

        if (objType.startsWith('house')) {
            const allSupportsAreValid = supportSurfaces.every(s => s === 'ground' || s === 'wall' || s === 'strong');
            if (!allSupportsAreValid) return null;
        }

        return baseHeight;
    }


    function createPreviewMesh(type) {
        let geom;
        if (type.startsWith('house_h')) {
            // Estraiamo l'altezza dal nome del tipo (es. 'house_h4' -> 4)
            const height = parseInt(type.split('_h')[1], 10);
            geom = new THREE.BoxGeometry(cellSize * 2, height, cellSize * 2); 
        } else {
            // Logica per Wall e StrongBlock rimane invariata
            geom = new THREE.BoxGeometry(cellSize, 1, cellSize);
        }

        const mat = new THREE.MeshStandardMaterial({
            color: type.startsWith('house') ? 0x2196f3 : (type === 'strong' ? 0xffa500 : 0x4caf50),
            transparent: true,
            opacity: 0.7
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData.type = type;
        return mesh;
    }

    function startDrag(type, evt) {
        if (dragging || getGameState() !== 'BUILDING') return;
        updateHeightMapFromScene();
        dragObject = createPreviewMesh(type);
        dragging = true;
        scene.add(dragObject);
        controls.enabled = false;
        updateDragPosition(evt); 
        window.addEventListener('pointermove', updateDragPosition);
        window.addEventListener('pointerup', finishDrag, { once: true });
        window.addEventListener('keydown', rotatePreview);
    }

    function updateDragPosition(evt) {
        if (!dragObject) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObject(grid.getPlaneMesh());
        if (!hits.length) return;
        currentPos = hits[0].point.clone();

        const { sx, sz } = getSpans(dragObject);
        const snappedX = cellSnap(currentPos.x, sx);
        const snappedZ = cellSnap(currentPos.z, sz);
        lastSnappedX = snappedX;
        lastSnappedZ = snappedZ;

        const ix0 = worldToIx(snappedX);
        const iz0 = worldToIz(snappedZ);
        const cells = cellsCovered(ix0, iz0, sx, sz);
        const objType = dragObject.userData.type;
        const baseH = canPlace(cells, objType);

        const box = new THREE.Box3().setFromObject(dragObject);
        const size = new THREE.Vector3();
        box.getSize(size);
        const halfH = size.y / 2;

        if (baseH === null) {
            dragObject.material.color.set(0xff4444);
            dragObject.position.set(snappedX, grid.getPlaneMesh().position.y + halfH, snappedZ);
        } else {
            const correctColor = objType === 'cube' 
                ? 0x4caf50  // Verde per Wall ('cube')
                : (objType === 'strong' 
                    ? 0xffa500 // Arancione per StrongBlock
                    : 0x2196f3); // Blu per House
            dragObject.material.color.set(correctColor);
            dragObject.position.set(snappedX, baseH + halfH, snappedZ);
        }
    }

    function rotatePreview(evt) {
        if (!dragObject || evt.code !== 'Space') return;
        evt.preventDefault();
        dragObject.rotation.y += Math.PI / 2;
        // Ricrea un evento fittizio per forzare l'aggiornamento della posizione
        const fakeEvt = { clientX: mouse.x, clientY: mouse.y }; 
        if (currentPos) updateDragPosition(fakeEvt); 
    }

    function finishDrag() {
        window.removeEventListener('pointermove', updateDragPosition);
        window.removeEventListener('keydown', rotatePreview);
        placeOrCancel();
        controls.enabled = true;
        dragging = false;
        dragObject = null;
        currentPos = null;
    }

    function placeOrCancel() {
        if (!dragObject) return;

        // Ottiene le informazioni di posizionamento dall'oggetto di anteprima
        const { sx, sz } = getSpans(dragObject);
        const ix0 = worldToIx(lastSnappedX);
        const iz0 = worldToIz(lastSnappedZ);
        const cells = cellsCovered(ix0, iz0, sx, sz);
        const objType = dragObject.userData.type;

        // Controlla se la posizione è valida
        const baseH = canPlace(cells, objType);
        if (baseH === null) {
            scene.remove(dragObject); // Posizione non valida, rimuove l'anteprima
            return;
        }

        // Calcola la posizione finale corretta
        // L'altezza dell'oggetto è già corretta nell'anteprima (dragObject)
        const halfH = dragObject.geometry.parameters.height / 2;
        const finalY = baseH + halfH;
        const finalPos = new THREE.Vector3(lastSnappedX, finalY, lastSnappedZ);

        let realObj;
        // Crea l'oggetto reale in base al tipo
        if (objType.startsWith('house_h')) {
            const height = dragObject.geometry.parameters.height;
            realObj = new House(scene, finalPos, cellSize, height);
        } else if (objType === 'cube') {
            realObj = new Wall(scene, finalPos, cellSize);
        } else if (objType === 'strong') {
            realObj = new StrongBlock(scene, finalPos, cellSize);
        }
        
        // Applica la rotazione dell'anteprima all'oggetto finale
        if (realObj) {
            realObj.mesh.rotation.y = dragObject.rotation.y;
        }
        
        // Pulisce la scena: rimuove l'anteprima e aggiorna la mappa delle altezze
        scene.remove(dragObject);
        updateHeightMapFromScene();
    }

    return { startDrag, updateHeightMapFromScene };
}

export { setupDragAndDrop };