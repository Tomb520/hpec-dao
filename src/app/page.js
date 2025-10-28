"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Search, AlertCircle, CheckCircle, Loader2, Grid3x3, ChevronRight, ArrowLeft, Wallet, Link as LinkIcon, Copy } from 'lucide-react';
import ImageIcon from 'lucide-react/dist/esm/icons/image';
import * as THREE from 'three';

// Error Boundary
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-gray-900 p-4 rounded-lg border-2 border-orange-700">
          <h1 className="text-xl text-orange-400">Error in 3D Visualization</h1>
          <pre className="text-sm text-white">{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Bitmap 3D Viewer
// Global cache for 3D parsed data - persists across all renders
const global3DCache = new Map();

function Bitmap3DViewer({ bitmapNumber, bitmapImage, transactions, parcels, onParcelClick }) {
  const mountRef = useRef(null);
  const isDraggingRef = useRef(false);
  const rotationRef = useRef({ x: 0.5, y: 0 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const zoomDistanceRef = useRef(150); // Use ref instead of state to avoid re-renders
  const [isLoading, setIsLoading] = useState(true);

  const parseMondrianFromImage = (imageDataUrl, txList) => {
    return new Promise((resolve) => {
      if (!imageDataUrl || !txList || txList.length === 0) {
        resolve([]);
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new window.Image();
      img.onerror = () => resolve([]);
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        const visited = new Set();
        const squares = [];
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];

            if (r > 200 && g > 100 && g < 180 && b < 50) {
              const key = `${x}-${y}`;
              if (!visited.has(key)) {
                // Safety limit: max 10,000 transactions per block (Bitcoin's actual max)
                if (squares.length >= 10000) {
                  console.warn(`3D visualization: transaction limit reached (${squares.length} squares found), stopping parse`);
                  resolve(squares);
                  return;
                }

                let minX = x,
                  maxX = x,
                  minY = y,
                  maxY = y;
                const stack = [{ x, y }];
                let pixelsInThisSquare = 0;

                while (stack.length > 0) {
                  const { x: cx, y: cy } = stack.pop();
                  const ckey = `${cx}-${cy}`;
                  if (visited.has(ckey)) continue;
                  if (cx < 0 || cx >= canvas.width || cy < 0 || cy >= canvas.height) continue;

                  // Safety check for infinite loops in single square
                  pixelsInThisSquare++;
                  if (pixelsInThisSquare > 1000000) {
                    console.warn(`Too many pixels in single square, stopping flood fill`);
                    break;
                  }

                  const cidx = (cy * canvas.width + cx) * 4;
                  const cr = pixels[cidx];
                  const cg = pixels[cidx + 1];
                  const cb = pixels[cidx + 2];

                  if (cr > 200 && cg > 100 && cg < 180 && cb < 50) {
                    visited.add(ckey);
                    minX = Math.min(minX, cx);
                    maxX = Math.max(maxX, cx);
                    minY = Math.min(minY, cy);
                    maxY = Math.max(maxY, cy);

                    stack.push({ x: cx + 1, y: cy });
                    stack.push({ x: cx - 1, y: cy });
                    stack.push({ x: cx, y: cy + 1 });
                    stack.push({ x: cx, y: cy - 1 });
                  }
                }

                const width = maxX - minX + 1;
                const height = maxY - minY + 1;
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;

                const scale = 0.15;
                const squareSize = Math.max(width, height);

                squares.push({
                  x: (centerX - canvas.width / 2) * scale,
                  z: (centerY - canvas.height / 2) * scale,
                  width: width * scale,
                  depth: height * scale,
                  height: squareSize * scale * 0.5 + 2,
                  txIndex: squares.length,
                });
              }
            }
          }
        }
        console.log(`✅ 3D visualization: Successfully parsed ${squares.length} transactions from ${visited.size} pixels`);
        resolve(squares);
      };
      img.src = imageDataUrl;
    });
  };

  useEffect(() => {
    if (!mountRef.current) return;
    let animationId, scene, camera, renderer;
    const initScene = async () => {
      try {
        setIsLoading(true);
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        camera = new THREE.PerspectiveCamera(60, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 2000);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mountRef.current.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);


        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); // Brighter for highlights
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        scene.add(directionalLight);

        const fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5); // Sky/ground for balance
        scene.add(fillLight);

        // Enable shadows globally (after renderer init)
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(500, 500),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
        );
        ground.rotation.x = -Math.PI / 2;
        scene.add(ground);

        const geometryCache = new Map();
        const getGeometry = (width, height, depth) => {
          const key = `${width.toFixed(2)}-${height.toFixed(2)}-${depth.toFixed(2)}`;
          if (!geometryCache.has(key)) {
            geometryCache.set(key, new THREE.BoxGeometry(width, height, depth));
          }
          return geometryCache.get(key);
        };

        // Check global cache first - persists across all renders
        const cacheKey = `${bitmapNumber}-${transactions.length}`;
        let squares;

        if (global3DCache.has(cacheKey)) {
          console.log(`✅ Using cached 3D data for bitmap ${bitmapNumber} (from cache)`);
          squares = global3DCache.get(cacheKey);
          setIsLoading(false);
        } else {
          console.log(`🔄 Parsing 3D data for bitmap ${bitmapNumber}...`);
          squares = await parseMondrianFromImage(bitmapImage, transactions);
          global3DCache.set(cacheKey, squares);
          console.log(`💾 Cached 3D data for bitmap ${bitmapNumber}`);
          setIsLoading(false);
        }

        squares.forEach((square, index) => {
          const hasParcel = index < parcels.length;
          const spacing = 0.5;
          const building = new THREE.Mesh(
            getGeometry(square.width - spacing, square.height, square.depth - spacing),
            new THREE.MeshStandardMaterial({ color: hasParcel ? 0xff8c00 : 0xff6600, roughness: 0.7, metalness: 0.3 })
          );
          building.position.set(square.x, square.height / 2, square.z);
          building.userData = { buildingIndex: index, bitmapNumber };
          scene.add(building);

          if (hasParcel) {
            const portal = new THREE.Mesh(
              new THREE.TorusGeometry(Math.min(square.width, square.depth) * 0.3, 0.3, 8, 16),
              new THREE.MeshStandardMaterial({
                color: 0x00ffff,
                emissive: 0x00ffff,
                emissiveIntensity: 0.5,
                roughness: 0.1,
                metalness: 0.9 // Shiny metallic torus for parcel "plaque" portal
              })
            );
            portal.position.set(square.x, square.height + 1, square.z);
            portal.rotation.x = Math.PI / 2;
            portal.userData = { isPortal: true, parcelId: parcels[index].id };
            portal.castShadow = true; // Enable shadows for light interaction
            scene.add(portal);
          }
        });

        camera.position.set(0, 100, 150);
        camera.lookAt(0, 0, 0);

        const handleMouseDown = (e) => {
          isDraggingRef.current = true;
          mouseRef.current = { x: e.clientX, y: e.clientY };
        };

        const handleMouseMove = (e) => {
          if (isDraggingRef.current) {
            const deltaX = e.clientX - mouseRef.current.x;
            const deltaY = e.clientY - mouseRef.current.y;
            rotationRef.current.y += deltaX * 0.005;
            rotationRef.current.x += deltaY * 0.005;
            rotationRef.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationRef.current.x));
            mouseRef.current = { x: e.clientX, y: e.clientY };
          }
        };

        const handleMouseUp = () => {
          isDraggingRef.current = false;
        };

        const handleWheel = (e) => {
          e.preventDefault();
          const delta = e.deltaY * -0.1;
          zoomDistanceRef.current = Math.max(50, Math.min(300, zoomDistanceRef.current + delta));
        };

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const handleClick = (e) => {
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObjects(scene.children);
          if (intersects.length > 0 && intersects[0].object.userData.isPortal && onParcelClick) {
            onParcelClick(intersects[0].object.userData.parcelId);
          }
        };

        renderer.domElement.addEventListener('mousedown', handleMouseDown);
        renderer.domElement.addEventListener('mousemove', handleMouseMove);
        renderer.domElement.addEventListener('mouseup', handleMouseUp);
        renderer.domElement.addEventListener('click', handleClick);
        renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

        const animate = () => {
          animationId = requestAnimationFrame(animate);
          const radius = zoomDistanceRef.current;

          // Horizontal rotation (Y-axis) - full circle around the scene
          const horizontalAngle = rotationRef.current.y;

          // Vertical rotation (X-axis) - limit to prevent flipping, only affects height
          const verticalAngle = rotationRef.current.x;

          // Camera orbits at constant radius (zoom only changes via scroll wheel)
          camera.position.x = radius * Math.sin(horizontalAngle);
          camera.position.z = radius * Math.cos(horizontalAngle);
          camera.position.y = 50 + (verticalAngle * 50); // Height changes with vertical drag

          camera.lookAt(0, 20, 0);
          renderer.render(scene, camera);
        };

        setIsLoading(false);
        animate();

        const handleResize = () => {
          if (mountRef.current && camera && renderer) {
            camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
          }
        };
        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
          if (renderer?.domElement) {
            renderer.domElement.removeEventListener('mousedown', handleMouseDown);
            renderer.domElement.removeEventListener('mousemove', handleMouseMove);
            renderer.domElement.removeEventListener('mouseup', handleMouseUp);
            renderer.domElement.removeEventListener('click', handleClick);
            renderer.domElement.removeEventListener('wheel', handleWheel);
          }
          if (animationId) cancelAnimationFrame(animationId);
          if (renderer) renderer.dispose();
          if (mountRef.current && renderer?.domElement) mountRef.current.removeChild(renderer.domElement);
        };
      } catch (error) {
        console.error('3D error:', error);
        setIsLoading(false);
      }
    };
    initScene();
  }, [bitmapNumber, bitmapImage, transactions, parcels, onParcelClick]);

  return (
    <div ref={mountRef} className="w-full h-full bg-gray-800" style={{ cursor: 'grab' }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-orange-400" size={48} />
        </div>
      )}
    </div>
  );
}

// Clickable Bitmap Grid Component (for home page 267651 only)
function ClickableBitmapGrid({ imageDataUrl, txList, parcels, otherChildren, onSquareClick }) {
  const canvasRef = useRef(null);
  const [hoveredSquare, setHoveredSquare] = useState(null);
  const squaresRef = useRef([]);

  useEffect(() => {
    if (!canvasRef.current || !imageDataUrl || !txList.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Calculate square positions
      const padding = 2;
      const numCols = Math.ceil(Math.sqrt(txList.length));
      const numRows = Math.ceil(txList.length / numCols);
      const cellWidth = (img.width - padding * (numCols + 1)) / numCols;
      const cellHeight = (img.height - padding * (numRows + 1)) / numRows;

      const squares = [];
      txList.forEach((tx, idx) => {
        const col = idx % numCols;
        const row = Math.floor(idx / numCols);
        const x = padding + col * (cellWidth + padding);
        const y = padding + row * (cellHeight + padding);

        squares.push({
          index: idx,
          x,
          y,
          width: cellWidth,
          height: cellHeight,
          hasParcel: idx < parcels.length,
          hasChild: idx >= parcels.length && idx < parcels.length + otherChildren.length
        });
      });

      squaresRef.current = squares;
    };

    img.src = imageDataUrl;
  }, [imageDataUrl, txList, parcels, otherChildren]);

  const getSquareAtPosition = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return squaresRef.current.find(sq =>
      x >= sq.x && x <= sq.x + sq.width &&
      y >= sq.y && y <= sq.y + sq.height
    );
  };

  const handleMouseMove = (e) => {
    const square = getSquareAtPosition(e.clientX, e.clientY);
    setHoveredSquare(square || null);
  };

  const handleClick = () => {
    if (hoveredSquare && (hoveredSquare.hasParcel || hoveredSquare.hasChild)) {
      onSquareClick(hoveredSquare.index);
    }
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const square = getSquareAtPosition(touch.clientX, touch.clientY);
      setHoveredSquare(square || null);

      if (square && (square.hasParcel || square.hasChild)) {
        onSquareClick(square.index);
      }
    }
  };

  const handleTouchEnd = () => {
    setHoveredSquare(null);
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSquare(null)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="w-full h-auto cursor-pointer"
        style={{
          opacity: hoveredSquare ? 0.9 : 1,
          transition: 'opacity 0.2s',
          touchAction: 'none'
        }}
      />
      {hoveredSquare && (hoveredSquare.hasParcel || hoveredSquare.hasChild) && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-80 text-white px-3 py-2 rounded-lg border-2 border-orange-500 pointer-events-none">
          <p className="text-sm font-semibold">
            {hoveredSquare.hasParcel ? `🟢 Parcel ${hoveredSquare.index + 1}` : `🟣 Child ${hoveredSquare.index - parcels.length + 1}`}
          </p>
          <p className="text-xs text-orange-300">Tap to explore</p>
        </div>
      )}
    </div>
  );
}

// Main App Component
export default function BitmapOCIApp() {
  const [bitmapNumber, setBitmapNumber] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bitmapImage, setBitmapImage] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [loadingParcels, setLoadingParcels] = useState(false);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [parcelChildren, setParcelChildren] = useState([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [show3DView, setShow3DView] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [otherChildren, setOtherChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [isHomePage, setIsHomePage] = useState(true); // Track if we're on home page (267651)

  // WALLET STATE
  const [activeTab, setActiveTab] = useState('bitmap');
  const [btcAddress, setBtcAddress] = useState('');
  const [adaAddress, setAdaAddress] = useState('');
  const [btcWallet, setBtcWallet] = useState('');
  const [cardanoWallet, setCardanoWallet] = useState('');
  const [btcSignature, setBtcSignature] = useState(''); // Store signature proof
  const [adaSignature, setAdaSignature] = useState(''); // Store signature proof
  const [discordUsername, setDiscordUsername] = useState('');
  const [linkages, setLinkages] = useState([]);
  const [walletError, setWalletError] = useState('');
  const [success, setSuccess] = useState('');

  // Load linkages
  useEffect(() => {
    const saved = localStorage.getItem('walletLinkages');
    if (saved) setLinkages(JSON.parse(saved));
  }, []);

  // Load bitmap 267651 by default on mount (home page)
  useEffect(() => {
    handleLookup(267651);
  }, []);

  // Wallet functions with signature verification
  const connectXverseWallet = async () => {
    setWalletError('');
    setBtcSignature('');
    try {
      if (typeof window.BitcoinProvider === 'undefined') {
        setWalletError('Install Xverse wallet');
        return;
      }
      const result = await window.BitcoinProvider.request('getAccounts', { purposes: ['payment', 'ordinals'] });
      if (result.result?.length > 0) {
        const addr = result.result.find(acc => acc.purpose === 'ordinals')?.address || result.result[0].address;

        // Request signature for verification
        const message = `Link wallet to HPEC DAO - ${Date.now()}`;
        try {
          const signResult = await window.BitcoinProvider.request('signMessage', {
            address: addr,
            message: message
          });

          setBtcAddress(addr);
          setBtcWallet('xverse');
          setBtcSignature(signResult.result); // Store signature proof
          setSuccess('Xverse connected and verified!');
        } catch (signErr) {
          setWalletError('Signature rejected - verification required');
        }
      }
    } catch (err) {
      setWalletError('Failed to connect Xverse');
    }
  };

  const connectUnisatWallet = async () => {
    setWalletError('');
    setBtcSignature('');
    try {
      if (typeof window.unisat === 'undefined') {
        setWalletError('Install Unisat wallet');
        return;
      }
      const accounts = await window.unisat.requestAccounts();
      if (accounts.length > 0) {
        const addr = accounts[0];

        // Request signature for verification
        const message = `Link wallet to HPEC DAO - ${Date.now()}`;
        try {
          const signature = await window.unisat.signMessage(message);

          setBtcAddress(addr);
          setBtcWallet('unisat');
          setBtcSignature(signature); // Store signature proof
          setSuccess('Unisat connected and verified!');
        } catch (signErr) {
          setWalletError('Signature rejected - verification required');
        }
      }
    } catch (err) {
      setWalletError('Failed to connect Unisat');
    }
  };

  const connectCardanoWallet = async (walletName) => {
    setWalletError('');
    setAdaSignature('');
    try {
      const wallet = window.cardano?.[walletName];
      if (!wallet) {
        setWalletError(`${walletName} not found`);
        return;
      }
      const api = await wallet.enable();
      const addresses = await api.getUsedAddresses();
      if (addresses.length > 0) {
        const addr = addresses[0];

        // Request signature for verification
        const message = `Link wallet to HPEC DAO - ${Date.now()}`;
        const messageHex = Buffer.from(message).toString('hex');

        try {
          const signature = await api.signData(addr, messageHex);

          setAdaAddress(addr);
          setCardanoWallet(walletName);
          setAdaSignature(signature.signature); // Store signature proof
          setSuccess(`${walletName} connected and verified!`);
        } catch (signErr) {
          setWalletError('Signature rejected - verification required');
        }
      }
    } catch (err) {
      setWalletError('Failed to connect Cardano');
    }
  };

  const submitLinkage = () => {
    if (!btcAddress || !adaAddress) {
      setWalletError('Connect both wallets');
      return;
    }
    if (!btcSignature || !adaSignature) {
      setWalletError('Both wallets must be verified with signatures');
      return;
    }
    const newLink = {
      btcAddress,
      adaAddress,
      btcWallet,
      cardanoWallet,
      btcSignature,
      adaSignature,
      discordUsername,
      timestamp: new Date().toISOString(),
      verified: true
    };
    const updated = [...linkages, newLink];
    setLinkages(updated);
    localStorage.setItem('walletLinkages', JSON.stringify(updated));
    setSuccess('✅ Verified wallets linked successfully!');
    setTimeout(() => {
      setBtcAddress('');
      setAdaAddress('');
      setBtcWallet('');
      setCardanoWallet('');
      setBtcSignature('');
      setAdaSignature('');
      setDiscordUsername('');
      setSuccess('');
    }, 3000);
  };

  const pages = Array(8).fill(0);
  const allPages = [
    '/content/01bba6c58af39d7f199aa2bceeaaba1ba91b23d2663bc4ef079a4b5e442dbf74i0',
    '/content/bb01dfa977a5cd0ee6e900f1d1f896b5ec4b1e3c7b18f09c952f25af6591809fi0',
    '/content/bb02e94f3062facf6aa2e47eeed348d017fd31c97614170dddb58fc59da304efi0',
    '/content/bb037ec98e6700e8415f95d1f5ca1fe1ba23a3f0c5cb7284d877e9ac418d0d32i0',
    '/content/bb9438f4345f223c6f4f92adf6db12a82c45d1724019ecd7b6af4fcc3f5786cei0',
    '/content/bb0542d4606a9e7eb4f31051e91f7696040db06ca1383dff98505618c34d7df7i0',
    '/content/bb06a4dffba42b6b513ddee452b40a67688562be4a1345127e4d57269e6b2ab6i0',
    '/content/bb076934c1c22007b315dd1dc0f8c4a2f9d52f348320cfbadc7c0bd99eaa5e18i0',
    '/content/bb986a1208380ec7db8df55a01c88c73a581069a51b5a2eb2734b41ba10b65c2i0',
  ];
  const satIndices = {
    92871: 1,
    92970: 1,
    123132: 1,
    365518: 1,
    700181: 1,
    826151: 1,
    827151: 1,
    828151: 1,
    828239: 1,
    828661: 1,
    829151: 1,
    830151: 1,
    832104: 2,
    832249: 2,
    832252: 2,
    832385: 4,
    833067: 1,
    833101: 3,
    833105: 4,
    833109: 4,
    833121: 8,
    834030: 2,
    834036: 2,
    834051: 17,
    834073: 4,
    836151: 1,
    837115: 2,
    837120: 2,
    837151: 1,
    837183: 3,
    837188: 2,
    838058: 5,
    838068: 2,
    838076: 2,
    838096: 1,
    838151: 1,
    838821: 1,
    839151: 1,
    839377: 1,
    839378: 2,
    839382: 2,
    839397: 1,
    840151: 1,
    841151: 1,
    842151: 1,
    845151: 1,
  };

  const generateVisualization = (transactions) => {
    if (transactions.length === 0) {
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 500;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, 500, 500);
      return canvas.toDataURL('image/png');
    }
    function logTxSize(value, max) {
      if (!value || value === 0) return 1;
      let scale = Math.ceil(Math.log10(value)) - 5;
      return Math.min(max || Infinity, Math.max(1, scale));
    }
    let blockWeight = 0;
    const txSizes = transactions.map((tx) => {
      const value = tx.out ? tx.out.reduce((sum, output) => sum + (output.value || 0), 0) : 0;
      const size = logTxSize(value, Infinity);
      blockWeight += size * size;
      return { tx, size };
    });
    const blockWidth = Math.ceil(Math.sqrt(blockWeight));
    const initialCanvasSize = Math.max(500, blockWidth * 60);
    const gridSize = initialCanvasSize / blockWidth;
    class MondrianLayout {
      constructor(width) {
        this.width = width;
        this.rowOffset = 0;
        this.rows = [];
        this.txMap = [];
      }
      getRow(position) {
        return this.rows[position.y - this.rowOffset];
      }
      getSlot(position) {
        if (this.getRow(position)) {
          return this.getRow(position).map[position.x];
        }
      }
      addRow() {
        const newRow = { y: this.rows.length + this.rowOffset, slots: [], map: {}, max: 0 };
        this.rows.push(newRow);
        return newRow;
      }
      addSlot(slot) {
        if (slot.r <= 0) return;
        if (this.getSlot(slot)) {
          const existingSlot = this.getSlot(slot);
          if (slot.r > existingSlot.r) existingSlot.r = slot.r;
          return existingSlot;
        } else {
          let insertAt = null;
          const row = this.getRow(slot);
          if (!row) return;
          for (let i = 0; i < row.slots.length && insertAt == null; i++) {
            if (row.slots[i].x > slot.x) insertAt = i;
          }
          if (insertAt == null) row.slots.push(slot);
          else row.slots.splice(insertAt || 0, 0, slot);
          row.map[slot.x] = slot;
          return slot;
        }
      }
      removeSlot(slot) {
        const row = this.getRow(slot);
        if (row) {
          delete row.map[slot.x];
          let indexOf = row.slots.indexOf(slot);
          row.slots.splice(indexOf, 1);
        }
      }
      fillSlot(slot, squareWidth) {
        const square = { left: slot.x, right: slot.x + squareWidth, bottom: slot.y, top: slot.y + squareWidth };
        this.removeSlot(slot);
        for (let rowIndex = slot.y; rowIndex < square.top; rowIndex++) {
          const row = this.getRow({ y: rowIndex });
          if (row) {
            let collisions = [];
            let maxExcess = 0;
            for (let i = 0; i < row.slots.length; i++) {
              const testSlot = row.slots[i];
              if (!(testSlot.x + testSlot.r < square.left || testSlot.x >= square.right)) {
                collisions.push(testSlot);
                let excess = Math.max(0, testSlot.x + testSlot.r - (slot.x + slot.r));
                maxExcess = Math.max(maxExcess, excess);
              }
            }
            if (square.right < this.width && !row.map[square.right]) {
              this.addSlot({ x: square.right, y: rowIndex, r: slot.r - squareWidth + maxExcess });
            }
            for (let i = 0; i < collisions.length; i++) {
              collisions[i].r = slot.x - collisions[i].x;
              if (collisions[i].r <= 0) this.removeSlot(collisions[i]);
            }
          } else {
            this.addRow();
            if (slot.x > 0) this.addSlot({ x: 0, y: rowIndex, r: slot.x });
            if (square.right < this.width) this.addSlot({ x: square.right, y: rowIndex, r: this.width - square.right });
          }
        }
        for (let rowIndex = Math.max(0, slot.y - squareWidth); rowIndex < slot.y; rowIndex++) {
          const row = this.getRow({ y: rowIndex });
          if (row) {
            for (let i = 0; i < row.slots.length; i++) {
              const testSlot = row.slots[i];
              if (testSlot.x < slot.x + squareWidth && testSlot.x + testSlot.r > slot.x && testSlot.y + testSlot.r >= slot.y) {
                const oldSlotWidth = testSlot.r;
                testSlot.r = slot.y - testSlot.y;
                if (testSlot.r <= 0) this.removeSlot(testSlot);
                let remaining = { x: testSlot.x + testSlot.r, y: testSlot.y, w: oldSlotWidth - testSlot.r, h: testSlot.r };
                while (remaining.w > 0 && remaining.h > 0) {
                  if (remaining.w <= remaining.h) {
                    this.addSlot({ x: remaining.x, y: remaining.y, r: remaining.w });
                    remaining.y += remaining.w;
                    remaining.h -= remaining.w;
                  } else {
                    this.addSlot({ x: remaining.x, y: remaining.y, r: remaining.h });
                    remaining.x += remaining.h;
                    remaining.w -= remaining.h;
                  }
                }
              }
            }
          }
        }
        return { x: slot.x, y: slot.y, r: squareWidth };
      }
      place(tx, size) {
        let found = false;
        let rowIndex = 0;
        let slotIndex = 0;
        let square = null;
        while (!found && rowIndex < this.rows.length) {
          const row = this.rows[rowIndex];
          while (!found && slotIndex < row.slots.length) {
            const testSlot = row.slots[slotIndex];
            if (testSlot.r >= size) {
              found = true;
              square = this.fillSlot(testSlot, size);
            }
            slotIndex++;
          }
          slotIndex = 0;
          rowIndex++;
        }
        if (!found) {
          const row = this.addRow();
          const slot = this.addSlot({ x: 0, y: row.y, r: this.width });
          square = this.fillSlot(slot, size);
        }
        tx.gridSquare = square;
        for (let x = 0; x < square.r; x++) {
          for (let y = 0; y < square.r; y++) {
            this.setTxMapCell({ x: square.x + x, y: square.y + y }, tx);
          }
        }
        return square;
      }
      setTxMapCell(coord, tx) {
        const offsetY = coord.y - this.rowOffset;
        while (this.txMap.length <= offsetY) {
          this.txMap.push(new Array(this.width).fill(null));
        }
        this.txMap[offsetY][coord.x] = tx;
      }
    }
    const layout = new MondrianLayout(blockWidth);
    const positions = [];
    txSizes.forEach((item) => {
      const square = layout.place(item.tx, item.size);
      positions.push({ x: square.x * gridSize, y: square.y * gridSize, size: square.r * gridSize });
    });
    let maxY = 0,
      maxX = 0;
    positions.forEach((pos) => {
      maxY = Math.max(maxY, pos.y + pos.size);
      maxX = Math.max(maxX, pos.x + pos.size);
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(initialCanvasSize, maxX + 20);
    canvas.height = Math.max(initialCanvasSize, maxY + 20);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const padding = 20;
    positions.forEach((pos) => {
      ctx.fillStyle = 'rgb(255, 140, 0)';
      ctx.fillRect(pos.x + padding / 2, pos.y + padding / 2, pos.size - padding, pos.size - padding);
    });
    return canvas.toDataURL('image/png');
  };

  async function fillPage(page) {
    let data = await fetch(`/api/ordinals?path=${encodeURIComponent(allPages[page])}`).then((r) => r.text());
    if (page === 2 || page === 3) {
      data = '[' + data + ']';
      data = JSON.parse(data);
      data = [data.slice(0, 99999), data.slice(100000, 199999)];
    } else {
      try {
        data = JSON.parse(data.replaceAll('\\n  ', ''));
      } catch (e) { }
      try {
        data = JSON.parse(data.replaceAll('  ', ''));
      } catch (e) { }
    }
    const fullSats = [];
    data[0].forEach((sat, i) => {
      fullSats.push(i === 0 ? parseInt(sat) : parseInt(fullSats[i - 1]) + parseInt(sat));
    });
    let filledArray = Array(100000).fill(0);
    data[1].forEach((index, i) => {
      filledArray[index] = fullSats[i];
    });
    pages[page] = filledArray;
  }

  async function getBitmapSat(bitmapNum) {
    if (bitmapNum < 0 || bitmapNum > 839999) {
      throw new Error('Bitmap number must be between 0 and 839,999');
    }
    const page = Math.floor(bitmapNum / 100000);
    if (!pages[page]) await fillPage(page);
    return pages[page][bitmapNum % 100000];
  }

  function getBitmapSatIndex(bitmapNum) {
    return satIndices[bitmapNum] || 0;
  }

  async function getBitmapInscriptionId(bitmapNum) {
    const sat = await getBitmapSat(bitmapNum);
    const path = `/r/sat/${sat}/at/${getBitmapSatIndex(bitmapNum)}`;
    const response = await fetch(`/api/ordinals?path=${encodeURIComponent(path)}`);
    const data = await response.json();
    return data.id;
  }
  async function getInscriptionOwner(inscriptionId) {
    try {
      console.log('🔍 Fetching owner for:', inscriptionId);
      const response = await fetch(`/api/ordinals?path=/inscription/${inscriptionId}`);
      const text = await response.text();
      console.log('📄 Response length:', text.length);
      console.log('📄 First 500 chars:', text.substring(0, 500));

      // Parse the HTML to extract address
      const addressMatch = text.match(/href=\/address\/([a-z0-9]+)>/);
      console.log('🎯 Address match:', addressMatch);

      if (addressMatch) {
        console.log('✅ Owner found:', addressMatch[1]);
        return addressMatch[1];
      }
      console.log('❌ No address match found');
      return 'Unknown';
    } catch (e) {
      console.error('❌ Error fetching owner:', e);
      return 'Unknown';
    }
  }

  async function getBlockData(blockHeight) {
    try {
      const response = await fetch(`https://blockchain.info/block-height/${blockHeight}?format=json`);
      const data = await response.json();
      if (data.blocks && data.blocks.length > 0) {
        const block = data.blocks[0];
        return {
          transactions: block.n_tx || 0,
          blockHash: block.hash,
          timestamp: block.time,
          size: block.size,
          txList: block.tx || [],
        };
      }
    } catch (e) { }
    return { transactions: 0, blockHash: null, timestamp: null, size: 0, txList: [] };
  }

  const fetchChildDetails = async (child) => {
    try {
      console.log('🎯 fetchChildDetails called for:', child.id);
      console.log('📋 Child has ownerAddress?', child.ownerAddress);

      if (child.ownerAddress) {
        console.log('✅ Owner already loaded:', child.ownerAddress);
        setSelectedChild(child);
      } else {
        console.log('🔍 Fetching owner...');
        const ownerAddress = await getInscriptionOwner(child.id);
        console.log('✅ Owner fetched:', ownerAddress);

        const updatedChild = { ...child, ownerAddress };
        console.log('📦 Updated child object:', updatedChild);

        setSelectedChild(updatedChild);
        console.log('✅ State updated with selectedChild');

        // Update the child in otherChildren array too
        setOtherChildren(prev =>
          prev.map(c => c.id === child.id ? updatedChild : c)
        );
        console.log('✅ Updated otherChildren array');
      }
    } catch (err) {
      console.error('❌ Error fetching child details:', err);
      setSelectedChild({ ...child, ownerAddress: 'Unknown' });
    }
  };

  const fetchParcelDetails = async (parcel) => {
    // Set the parcel as selected
    setSelectedParcel(parcel.id);

    // Fetch owner if not already loaded
    if (!parcel.ownerAddress) {
      try {
        const ownerAddress = await getInscriptionOwner(parcel.id);
        const updatedParcel = { ...parcel, ownerAddress };

        // Update the parcel in parcels array
        setParcels(prev =>
          prev.map(p => p.id === parcel.id ? updatedParcel : p)
        );
      } catch (err) {
        console.error('Error fetching parcel owner:', err);
      }
    }

    // Also fetch children of this parcel
    await fetchParcelChildren(parcel.id);
  };

  const fetchParcels = async (bitmapInscriptionId, bitmapNumber) => {
    setLoadingParcels(true);
    try {
      const response = await fetch(`/api/ordinals?path=${encodeURIComponent(`/r/children/${bitmapInscriptionId}`)}`);
      const data = await response.json();
      const childrenIds = data.children || data.ids || [];

      console.log(`🔍 Fetching ${childrenIds.length} children for bitmap ${bitmapNumber}`);

      if (childrenIds.length > 0) {
        // Fetch metadata for each child
        const childrenWithTypes = await Promise.all(
          childrenIds.map(async (childId, index) => {
            console.log(`\n--- Processing Child ${index + 1}: ${childId} ---`);

            try {
              // Get content type first
              let contentType = 'unknown';
              let hasImage = false;
              try {
                const contentHeadResponse = await fetch(`https://ordinals.com/content/${childId}`, { method: 'HEAD' });
                contentType = contentHeadResponse.headers.get('content-type') || 'unknown';
                hasImage = contentType.startsWith('image/') || contentType.includes('html');
                console.log(`  Content-Type: ${contentType}`);
              } catch (err) {
                console.log(`  ❌ Could not fetch content-type: ${err.message}`);
              }

              let isParcel = false;

              // For text/plain, fetch the actual content (it should be the parcel name)
              if (contentType.includes('text/plain')) {
                console.log(`  📄 Text/plain detected - fetching content...`);
                try {
                  const contentResponse = await fetch(`https://ordinals.com/content/${childId}`);
                  const contentText = await contentResponse.text();
                  console.log(`  Content (first 100 chars): "${contentText.substring(0, 100)}"`);
                  console.log(`  Content trimmed: "${contentText.trim()}"`);

                  // Strict pattern: Content should be EXACTLY "number.267651.bitmap"
                  const strictPattern = new RegExp(`^\\d+\\.${bitmapNumber}\\.bitmap$`, 'i');
                  isParcel = strictPattern.test(contentText.trim());
                  console.log(`  Pattern test (^\\d+\\.${bitmapNumber}\\.bitmap$): ${isParcel}`);
                  console.log(`  ✅ IS PARCEL: ${isParcel}`);

                  // Store the actual parcel name if it's a parcel
                  if (isParcel) {
                    return {
                      id: childId,
                      childNumber: index + 1,
                      contentType: contentType,
                      isParcel: isParcel,
                      hasImage: hasImage,
                      parcelName: contentText.trim(), // Store actual name!
                      detailsLoaded: false
                    };
                  }
                } catch (err) {
                  console.log(`  ❌ Could not fetch content: ${err.message}`);
                }
              } else {
                console.log(`  Skipping (not text/plain)`);
              }

              return {
                id: childId,
                childNumber: index + 1,
                contentType: contentType,
                isParcel: isParcel,
                hasImage: hasImage,
                detailsLoaded: false
              };
            } catch (err) {
              console.error(`  ❌ Error processing child:`, err);
              return {
                id: childId,
                childNumber: index + 1,
                contentType: 'unknown',
                isParcel: false,
                hasImage: false,
                detailsLoaded: false
              };
            }
          })
        );

        console.log('\n=== 🎯 FINAL PARCEL DETECTION RESULTS ===');

        // Separate parcels from other children
        const parcelsList = childrenWithTypes.filter(child => child.isParcel);
        const otherChildrenList = childrenWithTypes.filter(child => !child.isParcel);

        console.log(`✅ Parcels found: ${parcelsList.length}`);
        console.log(`✅ Other children: ${otherChildrenList.length}`);
        if (parcelsList.length > 0) {
          console.log('🎉 Parcel details:', parcelsList);
        } else {
          console.log('❌ NO PARCELS DETECTED - Check logs above for why');
        }

        setParcels(parcelsList);
        setOtherChildren(otherChildrenList);
      } else {
        setParcels([]);
        setOtherChildren([]);
      }
    } catch (err) {
      console.error('❌ Error fetching parcels:', err);
      setParcels([]);
      setOtherChildren([]);
    } finally {
      setLoadingParcels(false);
    }
  };

  const fetchParcelChildren = async (parcelId) => {
    setLoadingChildren(true);
    setSelectedParcel(parcelId);
    setParcelChildren([]);
    try {
      const response = await fetch(`/api/ordinals?path=${encodeURIComponent(`/r/children/${parcelId}`)}`);
      const data = await response.json();
      const childrenIds = data.children || data.ids || [];
      if (childrenIds.length > 0) {
        const childrenWithInfo = await Promise.all(
          childrenIds.map(async (childId) => {
            try {
              const contentResponse = await fetch(
                `/api/ordinals?path=${encodeURIComponent(`/r/inscription/${childId}`)}`
              );
              const contentData = await contentResponse.json();
              return {
                id: childId,
                contentType: contentData.content_type || 'unknown',
                hasImage: contentData.content_type?.startsWith('image/') || false,
              };
            } catch (e) {
              return { id: childId, contentType: 'unknown', hasImage: false };
            }
          })
        );
        setParcelChildren(childrenWithInfo);
      } else {
        setParcelChildren([]);
      }
    } catch (err) {
      console.error('Error fetching parcel children:', err);
      setParcelChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  };

  const handleLookup = async (bitmapNum = null) => {
    setError('');
    setResult(null);
    setBitmapImage(null);
    setParcels([]);
    setSelectedParcel(null);
    setParcelChildren([]);

    const num = bitmapNum !== null ? bitmapNum : parseInt(bitmapNumber.trim(), 10);

    if (isNaN(num) || num === null || num === undefined) {
      setError('Please enter a valid number');
      return;
    }
    if (num < 0 || num > 839999) {
      setError('Bitmap number must be between 0 and 839,999');
      return;
    }
    // Set home page mode if looking up 267651
    setIsHomePage(num === 267651);

    setLoading(true);
    try {
      const sat = await getBitmapSat(num);
      const inscriptionId = await getBitmapInscriptionId(num);
      const ownerAddress = await getInscriptionOwner(inscriptionId);
      const satIndex = getBitmapSatIndex(num);
      const blockData = await getBlockData(num);
      setResult({
        bitmapNumber: num,
        sat: sat,
        inscriptionId: inscriptionId,
        ownerAddress: ownerAddress,
        satIndex: satIndex,
        blockHeight: num,
        transactions: blockData.transactions,
        blockHash: blockData.blockHash,
        timestamp: blockData.timestamp,
        size: blockData.size,
        txList: blockData.txList,
      });
      if (blockData.transactions > 0) {
        const img = generateVisualization(blockData.txList);
        setBitmapImage(img);
      }
      await fetchParcels(inscriptionId, num);
    } catch (err) {
      setError(err.message || 'An error occurred while fetching data');
    } finally {
      setLoading(false);
    }
  };

  // Preload 3D data for bitmap 267651 on mount
  const preload3DData = async (bitmapNum) => {
    try {
      console.log(`🚀 Preloading 3D data for bitmap ${bitmapNum}...`);
      const blockData = await getBlockData(bitmapNum);
      if (blockData.transactions > 0) {
        const img = generateVisualization(blockData.txList);

        // Parse and cache the 3D data
        const parseMondrianFromImage = (imageDataUrl, txList) => {
          return new Promise((resolve) => {
            if (!imageDataUrl || !txList || txList.length === 0) {
              resolve([]);
              return;
            }
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new window.Image();
            img.onerror = () => resolve([]);
            img.onload = () => {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const pixels = imageData.data;
              const visited = new Set();
              const squares = [];
              for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                  const idx = (y * canvas.width + x) * 4;
                  const r = pixels[idx];
                  const g = pixels[idx + 1];
                  const b = pixels[idx + 2];

                  if (r > 200 && g > 100 && g < 180 && b < 50) {
                    const key = `${x}-${y}`;
                    if (!visited.has(key)) {
                      if (squares.length >= 10000) {
                        console.warn(`Preload: transaction limit reached`);
                        resolve(squares);
                        return;
                      }

                      let minX = x, maxX = x, minY = y, maxY = y;
                      const stack = [{ x, y }];
                      let pixelsInThisSquare = 0;

                      while (stack.length > 0) {
                        const { x: cx, y: cy } = stack.pop();
                        const ckey = `${cx}-${cy}`;
                        if (visited.has(ckey)) continue;
                        if (cx < 0 || cx >= canvas.width || cy < 0 || cy >= canvas.height) continue;

                        pixelsInThisSquare++;
                        if (pixelsInThisSquare > 1000000) break;

                        const cidx = (cy * canvas.width + cx) * 4;
                        const cr = pixels[cidx];
                        const cg = pixels[cidx + 1];
                        const cb = pixels[cidx + 2];

                        if (cr > 200 && cg > 100 && cg < 180 && cb < 50) {
                          visited.add(ckey);
                          minX = Math.min(minX, cx);
                          maxX = Math.max(maxX, cx);
                          minY = Math.min(minY, cy);
                          maxY = Math.max(maxY, cy);

                          stack.push({ x: cx + 1, y: cy });
                          stack.push({ x: cx - 1, y: cy });
                          stack.push({ x: cx, y: cy + 1 });
                          stack.push({ x: cx, y: cy - 1 });
                        }
                      }

                      const width = maxX - minX + 1;
                      const height = maxY - minY + 1;
                      const centerX = (minX + maxX) / 2;
                      const centerY = (minY + maxY) / 2;
                      const scale = 0.15;
                      const squareSize = Math.max(width, height);

                      squares.push({
                        x: (centerX - canvas.width / 2) * scale,
                        z: (centerY - canvas.height / 2) * scale,
                        width: width * scale,
                        depth: height * scale,
                        height: squareSize * scale * 0.5 + 2,
                        txIndex: squares.length,
                      });
                    }
                  }
                }
              }
              resolve(squares);
            };
            img.src = imageDataUrl;
          });
        };

        const squares = await parseMondrianFromImage(img, blockData.txList);
        const cacheKey = `${bitmapNum}-${blockData.txList.length}`;
        global3DCache.set(cacheKey, squares);
        console.log(`✅ Preloaded and cached 3D data for bitmap ${bitmapNum} (${squares.length} transactions)`);
      }
    } catch (err) {
      console.error(`Failed to preload 3D data for bitmap ${bitmapNum}:`, err);
    }
  };

  // Preload bitmap 267651 on mount
  useEffect(() => {
    preload3DData(267651);
  }, []);

  return (
    <div className="min-h-screen bg-black p-6">
      {isFullscreen && show3DView && result && bitmapImage && (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={() => {
                setIsFullscreen(false);
                setShow3DView(false);
              }}
              className="bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-orange-500 transition-colors"
            >
              Exit Fullscreen
            </button>
          </div>
          <ErrorBoundary>
            <Bitmap3DViewer
              bitmapNumber={result.bitmapNumber}
              bitmapImage={bitmapImage}
              transactions={result.txList}
              parcels={[]}
              onParcelClick={fetchParcelChildren}
            />
          </ErrorBoundary>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        {/* HPEC DAO HEADER WITH TABS */}
        <div className="bg-gradient-to-r from-purple-900 to-orange-900 rounded-2xl shadow-2xl p-8 mb-6 border-2 border-orange-700">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Wallet className="text-orange-400" size={40} />
            HPEC DAO - Bitmap 267651
          </h1>
          <p className="text-orange-200 mb-4">Onchain Indexer & Wallet Linking for HPEC Community</p>

          {/* TAB NAVIGATION */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveTab('bitmap')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${activeTab === 'bitmap' ? 'bg-orange-600 text-white' : 'bg-black/30 text-orange-200 hover:bg-black/50'}`}
            >
              Bitmap Lookup
            </button>
            <button
              onClick={() => setActiveTab('link')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${activeTab === 'link' ? 'bg-purple-600 text-white' : 'bg-black/30 text-orange-200 hover:bg-black/50'}`}
            >
              <LinkIcon className="inline mr-2" size={16} />
              Link Wallets
            </button>
          </div>
        </div>

        {/* BITMAP LOOKUP TAB */}
        {activeTab === 'bitmap' && (
          <>
            <div className="bg-gray-900 rounded-2xl shadow-xl p-8 mb-6 border border-orange-700">
              <div className="space-y-4">
                <div className="flex gap-3">
                  {!isHomePage && result && (
                    <button
                      onClick={() => {
                        setBitmapNumber('267651');
                        handleLookup(267651);
                      }}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-500 transition-colors flex items-center gap-2"
                    >
                      ← Home
                    </button>
                  )}
                  <div className="flex gap-3 w-full">
                    <input
                      type="text"
                      min="0"
                      max="839999"
                      value={bitmapNumber}
                      onChange={(e) => setBitmapNumber(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLookup()}
                      placeholder="Enter bitmap number (0-839999)"
                      className="flex-1 px-4 py-3 bg-gray-800 border-2 border-orange-600 rounded-lg focus:border-orange-400 focus:outline-none text-white text-lg placeholder-orange-300"
                    />
                    <button
                      onClick={() => {
                        document.activeElement?.blur();
                        setTimeout(() => handleLookup(), 100);
                      }}
                      disabled={loading}
                      className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          Loading
                        </>
                      ) : (
                        <>
                          <Search size={20} />
                          Lookup
                        </>
                      )}
                    </button>
                  </div>
                  {error && (
                    <div className="bg-orange-900 border-2 border-orange-700 rounded-lg p-4 flex items-start gap-3">
                      <AlertCircle className="text-orange-400 flex-shrink-0 mt-0.5" size={20} />
                      <p className="text-orange-200">{error}</p>
                    </div>
                  )}
                </div>
              </div>

              {result && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-orange-700">
                    <div className="flex items-center gap-3 mb-6">
                      <CheckCircle className="text-orange-400" size={28} />
                      <h2 className="text-2xl font-bold text-white">Results</h2>
                      <button
                        onClick={() => {
                          if (!show3DView) {
                            setShow3DView(true);
                            setIsFullscreen(true);
                          } else {
                            setShow3DView(false);
                            setIsFullscreen(false);
                          }
                        }}
                        className="ml-auto bg-orange-600 text-white rounded-lg px-4 py-2 font-semibold hover:bg-orange-500 transition-all"
                      >
                        {show3DView ? '2D View' : '3D View'}
                      </button>
                      {!show3DView && (
                        <p className="text-orange-400 text-sm mt-2 text-center">
                          Allow longer for higher numbers of transactions to render - please be patient!
                        </p>
                      )}
                    </div>
                    {bitmapImage && !show3DView && (
                      <div className="space-y-2 mb-6">
                        <p className="text-sm text-orange-300">
                          Block Visualization (Transaction Grid)
                          {isHomePage && <span className="ml-2 text-green-400">• Click squares to explore</span>}
                        </p>
                        <div className="bg-gray-800 rounded-lg border border-orange-600 overflow-hidden w-full">
                          {isHomePage ? (
                            <ClickableBitmapGrid
                              imageDataUrl={bitmapImage}
                              txList={result.txList}
                              parcels={parcels}
                              otherChildren={otherChildren}
                              onSquareClick={(index) => {
                                // Check if this transaction has a parcel
                                if (index < parcels.length) {
                                  fetchParcelChildren(parcels[index].id);
                                } else if (index < parcels.length + otherChildren.length) {
                                  // It's an "other child"
                                  const childIndex = index - parcels.length;
                                  setSelectedChild(otherChildren[childIndex]);
                                  setSelectedParcel(null);
                                }
                              }}
                            />
                          ) : (
                            <img
                              src={bitmapImage}
                              alt={`Visualization for block ${result.bitmapNumber}`}
                              className="w-full h-auto"
                            />
                          )}
                        </div>
                        <p className="text-xs text-orange-400 text-center">
                          {result.transactions} transactions • 1 square = 1 transaction
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center">
                        <p className="text-sm text-orange-300 mb-1 text-center">Bitmap Number</p>
                        <p className="text-lg font-bold text-orange-400 text-center">{result.bitmapNumber}</p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center">
                        <p className="text-sm text-orange-300 mb-1 text-center">Block Height</p>
                        <p className="text-lg font-semibold text-white text-center">{result.blockHeight}</p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center">
                        <p className="text-sm text-orange-300 mb-1 text-center">Sat Number</p>
                        <p className="text-sm font-semibold text-white text-center truncate">{result.sat}</p>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center group relative">
                        <p className="text-sm text-orange-300 mb-1 text-center">Owner Address</p>
                        <p className="text-xs font-mono text-white text-center truncate w-32" title={result.ownerAddress}>
                          {result.ownerAddress ? `${result.ownerAddress.slice(0, 6)}...${result.ownerAddress.slice(-4)}` : 'Unknown'}
                        </p>
                        <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-gray-900 text-orange-300 text-xs p-2 rounded-lg border border-orange-600 opacity-0 group-hover:opacity-100 transition-opacity z-10 max-w-xs break-all pointer-events-none">
                          {result.ownerAddress || 'Unknown'}
                        </span>
                      </div>
                      <div className="bg-orange-900 rounded-lg p-4 border-2 border-orange-700 w-40 h-40 flex flex-col justify-center items-center">
                        <p className="text-sm text-orange-300 mb-1 text-center">Block Transactions</p>
                        <p className="text-lg font-bold text-orange-400 text-center">{result.transactions}</p>
                      </div>
                      {result.blockHash && (
                        <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center group relative">
                          <p className="text-sm text-orange-300 mb-1 text-center">Block Hash</p>
                          <p className="text-xs font-mono text-white text-center truncate w-32" title={result.blockHash}>{result.blockHash}</p>
                          <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-gray-900 text-orange-300 text-xs p-2 rounded-lg border border-orange-600 opacity-0 group-hover:opacity-100 transition-opacity z-10 max-w-xs break-all pointer-events-none">
                            {result.blockHash}
                          </span>
                        </div>
                      )}
                      {result.timestamp && (
                        <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center">
                          <p className="text-sm text-orange-300 mb-1 text-center">Block Timestamp</p>
                          <p className="text-xs text-white text-center line-clamp-2">{new Date(result.timestamp * 1000).toLocaleString()}</p>
                        </div>
                      )}
                      {result.size > 0 && (
                        <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-center items-center">
                          <p className="text-sm text-orange-300 mb-1 text-center">Block Size</p>
                          <p className="text-sm text-white text-center">{(result.size / 1024).toFixed(2)} KB</p>
                        </div>
                      )}
                      {result.satIndex > 0 && (
                        <div className="bg-orange-900 rounded-lg p-4 border-2 border-orange-700 w-40 h-40 flex flex-col justify-center items-center">
                          <p className="text-sm text-orange-300 mb-1 text-center">Sat Index (Reinscription)</p>
                          <p className="text-lg font-semibold text-orange-400 text-center">{result.satIndex}</p>
                        </div>
                      )}
                      <div className="bg-gray-800 rounded-lg p-4 border border-orange-600 w-40 h-40 flex flex-col justify-between items-center group relative">
                        <div className="text-center">
                          <p className="text-sm text-orange-300 mb-1">Inscription ID</p>
                          <p className="text-xs font-mono text-white truncate w-32" title={result.inscriptionId}>{result.inscriptionId}</p>
                          <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-gray-900 text-orange-300 text-xs p-2 rounded-lg border border-orange-600 opacity-0 group-hover:opacity-100 transition-opacity z-10 max-w-xs break-all pointer-events-none">
                            {result.inscriptionId}
                          </span>
                        </div>
                        <a
                          href={`https://ordinals.com/inscription/${result.inscriptionId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-orange-400 hover:text-orange-300 font-semibold"
                        >
                          View on ordinals.com &rarr;
                        </a>
                      </div>
                    </div>

                  </div>

                  <div className="space-y-6">
                    <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-orange-700">
                      <div className="flex items-center gap-3 mb-6">
                        <Grid3x3 className="text-orange-400" size={28} />
                        <h2 className="text-2xl font-bold text-white">Parcels</h2>
                        {loadingParcels && <Loader2 className="animate-spin text-orange-400" size={20} />}
                      </div>
                      {parcels.length === 0 && otherChildren.length === 0 && !loadingParcels && (
                        <p className="text-orange-300 text-center py-8">No children found for this bitmap</p>
                      )}
                      {parcels.length > 0 && (
                        <div className="mb-8">
                          <div className="flex items-center gap-3 mb-4">
                            <Grid3x3 className="text-green-400" size={28} />
                            <h2 className="text-2xl font-bold text-white">Parcels ({parcels.length})</h2>
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-96 overflow-y-auto">
                            {parcels.map((parcel, index) => {
                              // Use the actual parcel name from content, or fallback to generated name
                              const parcelName = parcel.parcelName || `${index}.${result.bitmapNumber}.bitmap`;
                              return (
                                <button
                                  key={parcel.id}
                                  onClick={() => fetchParcelDetails(parcel)}
                                  className={`group bg-gray-800 rounded-lg border-2 transition-all overflow-hidden relative ${selectedParcel === parcel.id
                                      ? 'border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.8)] scale-105'
                                      : 'border-green-600 hover:border-green-400'
                                    }`}
                                >
                                  <div className="aspect-square relative">
                                    {parcel.hasImage ? (
                                      <img
                                        src={`https://ordinals.com/content/${parcel.id}`}
                                        alt={parcelName}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          e.target.style.display = 'none';
                                          e.target.nextSibling.style.display = 'flex';
                                        }}
                                      />
                                    ) : null}
                                    <div
                                      className={`w-full h-full bg-green-800/30 flex items-center justify-center ${parcel.hasImage ? 'hidden' : 'flex'
                                        }`}
                                    >
                                      <ImageIcon className="text-green-400/50" size={48} />
                                    </div>
                                  </div>
                                  <div className="p-3 bg-gray-900 border-t border-green-600">
                                    <p className="text-xs text-green-300 truncate">{parcelName}</p>
                                    <p className="text-xs text-gray-400 truncate font-mono mt-1">{parcel.id.slice(0, 8)}...</p>
                                  </div>
                                  <div className="absolute top-2 right-2 bg-green-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ChevronRight className="text-white" size={16} />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-green-300 text-center mt-4 text-sm">
                            Showing all {parcels.length} parcels (using .bitmap naming convention)
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Other Children */}
                    {otherChildren.length > 0 && (
                      <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-purple-700 mt-6">
                        <div className="flex items-center gap-3 mb-6">
                          <Grid3x3 className="text-purple-400" size={28} />
                          <h2 className="text-2xl font-bold text-white">Other Children ({otherChildren.length})</h2>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-96 overflow-y-auto">
                          {otherChildren.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => fetchChildDetails(child)}
                              className={`group bg-gray-800 rounded-lg border-2 transition-all overflow-hidden relative ${selectedChild?.id === child.id
                                  ? 'border-purple-400 shadow-[0_0_20px_rgba(192,132,252,0.8)] scale-105'
                                  : 'border-purple-600 hover:border-purple-400 hover:shadow-[0_0_15px_rgba(192,132,252,0.5)]'
                                }`}
                            >
                              <div className="aspect-square relative">
                                {child.hasImage ? (
                                  child.contentType?.startsWith('image/') ? (
                                    <img
                                      src={`https://ordinals.com/content/${child.id}`}
                                      alt={`Child ${child.childNumber}`}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.parentElement.querySelector('.fallback-icon').style.display = 'flex';
                                      }}
                                    />
                                  ) : (
                                    <iframe
                                      src={`https://ordinals.com/content/${child.id}`}
                                      title={`Child ${child.childNumber}`}
                                      className="w-full h-full border-0 pointer-events-none"
                                      sandbox="allow-scripts"
                                    />
                                  )
                                ) : null}
                                <div className={`fallback-icon w-full h-full bg-purple-800/30 flex items-center justify-center absolute inset-0 ${child.hasImage ? 'hidden' : 'flex'}`}>
                                  <ImageIcon className="text-purple-400/50" size={32} />
                                </div>
                              </div>
                              <div className="p-2 bg-gray-900 border-t border-purple-600">
                                <p className="text-xs text-purple-300 truncate">Child #{child.childNumber}</p>
                                <p className="text-xs text-gray-400 truncate font-mono">{child.id.slice(0, 8)}...</p>
                                <p className="text-xs text-green-400 truncate font-mono">
                                  {child.ownerAddress ? `${child.ownerAddress.slice(0, 6)}***${child.ownerAddress.slice(-4)}` : 'Click to view'}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Selected Child Detail */}
                    {selectedChild && (
                      <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-purple-700">
                        <div className="flex items-center gap-3 mb-6">
                          <button
                            onClick={() => setSelectedChild(null)}
                            className="text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            <ArrowLeft size={24} />
                          </button>
                          <h2 className="text-2xl font-bold text-white">Child Inscription Details</h2>
                        </div>

                        <div className="bg-gray-800 rounded-lg p-4 border border-purple-600 mb-4">
                          <p className="text-xs text-purple-300 mb-1">Inscription ID</p>
                          <p className="text-xs font-mono text-white break-all">{selectedChild.id}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-gray-800 rounded-lg p-4 border border-purple-600">
                            <p className="text-xs text-purple-300 mb-1">Child Number</p>
                            <p className="text-white font-semibold">#{selectedChild.childNumber}</p>
                          </div>

                          <div className="bg-gray-800 rounded-lg p-4 border border-purple-600">
                            <p className="text-xs text-purple-300 mb-1">Content Type</p>
                            <p className="text-white font-semibold">{selectedChild.contentType}</p>
                          </div>

                          <div className="bg-gray-800 rounded-lg p-4 border border-purple-600 col-span-2">
                            <p className="text-xs text-purple-300 mb-1">Owner</p>
                            <p className="text-white font-mono text-sm truncate" title={selectedChild.ownerAddress || 'Unknown'}>
                              {selectedChild.ownerAddress ? `${selectedChild.ownerAddress.slice(0, 6)}***${selectedChild.ownerAddress.slice(-4)}` : 'Unknown'}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          {selectedChild.hasImage ? (
                            <div className="bg-gray-800 rounded-lg p-4 border border-purple-600">
                              <p className="text-xs text-purple-300 mb-2">Preview</p>
                              {selectedChild.contentType?.startsWith('image/') ? (
                                <img
                                  src={`https://ordinals.com/content/${selectedChild.id}`}
                                  alt={`Child ${selectedChild.childNumber}`}
                                  className="w-full max-h-96 object-contain rounded"
                                  onError={(e) => {
                                    e.target.parentElement.innerHTML = '<div class="text-center py-8"><p class="text-purple-300">Failed to load preview</p></div>';
                                  }}
                                />
                              ) : (
                                <iframe
                                  src={`https://ordinals.com/content/${selectedChild.id}`}
                                  title={`Child ${selectedChild.childNumber}`}
                                  className="w-full h-96 border-0 rounded bg-white"
                                  sandbox="allow-scripts"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="bg-gray-800 rounded-lg p-8 border border-purple-600 text-center">
                              <ImageIcon className="text-purple-400/50 mx-auto mb-2" size={64} />
                              <p className="text-purple-300">No preview available</p>
                            </div>
                          )}
                        </div>

                        <a
                          href={`https://ordinals.com/inscription/${selectedChild.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 block text-center px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-500 transition-colors"
                        >
                          View on ordinals.com &rarr;
                        </a>
                      </div>
                    )}

                    {selectedParcel && (
                      <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-green-700 mb-6">
                        <div className="flex items-center gap-3 mb-6">
                          <button
                            onClick={() => {
                              setSelectedParcel(null);
                              setParcelChildren([]);
                            }}
                            className="text-green-400 hover:text-green-300 transition-colors"
                          >
                            <ArrowLeft size={24} />
                          </button>
                          <h2 className="text-2xl font-bold text-white">Parcel Inscription Details</h2>
                        </div>

                        {(() => {
                          const parcelData = parcels.find(p => p.id === selectedParcel);
                          if (!parcelData) return null;

                          return (
                            <>
                              <div className="bg-gray-800 rounded-lg p-4 border border-green-600 mb-4">
                                <p className="text-xs text-green-300 mb-1">Inscription ID</p>
                                <p className="text-xs font-mono text-white break-all">{parcelData.id}</p>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-800 rounded-lg p-4 border border-green-600">
                                  <p className="text-xs text-green-300 mb-1">Parcel Name</p>
                                  <p className="text-white font-semibold">{parcelData.parcelName || 'Unknown'}</p>
                                </div>

                                <div className="bg-gray-800 rounded-lg p-4 border border-green-600">
                                  <p className="text-xs text-green-300 mb-1">Content Type</p>
                                  <p className="text-white font-semibold">{parcelData.contentType}</p>
                                </div>

                                <div className="bg-gray-800 rounded-lg p-4 border border-green-600 col-span-2">
                                  <p className="text-xs text-green-300 mb-1">Owner</p>
                                  <p className="text-white font-mono text-sm truncate" title={parcelData.ownerAddress || 'Loading...'}>
                                    {parcelData.ownerAddress ? `${parcelData.ownerAddress.slice(0, 6)}***${parcelData.ownerAddress.slice(-4)}` : 'Loading...'}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4">
                                {parcelData.hasImage ? (
                                  <div className="bg-gray-800 rounded-lg p-4 border border-green-600">
                                    <p className="text-xs text-green-300 mb-2">Preview</p>
                                    {parcelData.contentType?.startsWith('image/') ? (
                                      <img
                                        src={`https://ordinals.com/content/${parcelData.id}`}
                                        alt={parcelData.parcelName}
                                        className="w-full max-h-96 object-contain rounded"
                                        onError={(e) => {
                                          e.target.parentElement.innerHTML = '<div class="text-center py-8"><p class="text-green-300">Failed to load preview</p></div>';
                                        }}
                                      />
                                    ) : (
                                      <iframe
                                        src={`https://ordinals.com/content/${parcelData.id}`}
                                        title={parcelData.parcelName}
                                        className="w-full h-96 border-0 rounded bg-white"
                                        sandbox="allow-scripts"
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <div className="bg-gray-800 rounded-lg p-8 border border-green-600 text-center">
                                    <ImageIcon className="text-green-400/50 mx-auto mb-2" size={64} />
                                    <p className="text-green-300">No preview available</p>
                                  </div>
                                )}
                              </div>

                              <a
                                href={`https://ordinals.com/inscription/${parcelData.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-4 block text-center px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition-colors"
                              >
                                View on ordinals.com &rarr;
                              </a>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {selectedParcel && (
                      <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border border-orange-700">
                        <div className="flex items-center gap-3 mb-6">
                          <h2 className="text-2xl font-bold text-white">Parcel Children ({parcelChildren.length})</h2>
                          {loadingChildren && <Loader2 className="animate-spin text-orange-400" size={20} />}
                        </div>
                        {parcelChildren.length === 0 && !loadingChildren && (
                          <p className="text-orange-300 text-center py-8">No children found for this parcel</p>
                        )}
                        {parcelChildren.length > 0 && (
                          <div className="space-y-3">
                            {parcelChildren.map((child, index) => {
                              const childNum = index + 1;
                              const childName = `${childNum}.${result.bitmapNumber}.bitmap`; // Assumes child inherits bitmap context; adjust if needed
                              return (
                                <div
                                  key={child.id}
                                  className="bg-gray-800 rounded-lg border border-orange-600 p-4 flex gap-4"
                                >
                                  <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-orange-800/30">
                                    {child.hasImage ? (
                                      <img
                                        src={`https://ordinals.com/content/${child.id}`}
                                        alt={`Child ${childNum}`}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          e.target.style.display = 'none';
                                          e.target.nextSibling.style.display = 'flex';
                                        }}
                                      />
                                    ) : null}
                                    <div
                                      className={`w-full h-full flex items-center justify-center ${child.hasImage ? 'hidden' : 'flex'
                                        }`}
                                    >
                                      <ImageIcon className="text-orange-400/50" size={32} />
                                    </div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-orange-300 mb-1">{childName}</p>
                                    <p className="text-xs font-mono text-white break-all mb-2">{child.id}</p>
                                    <p className="text-xs text-gray-400">{child.contentType}</p>
                                    <a
                                      href={`https://ordinals.com/inscription/${child.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-block mt-2 text-xs text-orange-400 hover:text-orange-300"
                                    >
                                      View on ordinals.com →
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
        )}

            {/* WALLET LINKING TAB */}
            {activeTab === 'link' && (
              <div className="bg-gray-900 rounded-2xl shadow-xl p-8 border-2 border-purple-700">
                <h2 className="text-2xl font-bold text-white mb-6">Link Your Wallets for HPEC DAO</h2>
                <p className="text-gray-300 mb-6">Connect your Bitcoin wallet holding HPEC parcels/children and link it to your Cardano wallet for ADA distributions.</p>

                {/* Success Message */}
                {success && (
                  <div className="mb-6 p-4 bg-green-900/50 border border-green-700 rounded-lg">
                    <p className="text-green-300">{success}</p>
                  </div>
                )}

                {/* Error Message */}
                {walletError && (
                  <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg">
                    <AlertCircle className="inline mr-2" size={20} />
                    <span className="text-red-300">{walletError}</span>
                  </div>
                )}

                <div className="space-y-6">
                  {/* Bitcoin Wallet */}
                  <div className="bg-gray-800 rounded-xl p-6 border-2 border-purple-600">
                    <h3 className="text-xl font-bold text-white mb-4">Step 1: Connect Bitcoin Wallet</h3>
                    <p className="text-gray-300 mb-4">Connect to verify ownership of HPEC parcels/children</p>

                    <div className="flex gap-3 mb-4">
                      <button
                        onClick={connectXverseWallet}
                        className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-500 transition-colors"
                      >
                        {btcWallet === 'xverse' ? '✓ Xverse Connected' : 'Connect Xverse'}
                      </button>
                      <button
                        onClick={connectUnisatWallet}
                        className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-500 transition-colors"
                      >
                        {btcWallet === 'unisat' ? '✓ Unisat Connected' : 'Connect Unisat'}
                      </button>
                    </div>

                    {btcAddress && (
                      <div className="bg-gray-900 rounded-lg p-3 border border-purple-500">
                        <p className="text-xs text-purple-300 mb-1">Connected Address:</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono text-white break-all flex-1">{btcAddress}</p>
                          <button
                            onClick={() => navigator.clipboard.writeText(btcAddress)}
                            className="p-2 bg-purple-700 rounded hover:bg-purple-600"
                          >
                            <Copy size={14} className="text-white" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cardano Wallet */}
                  <div className="bg-gray-800 rounded-xl p-6 border-2 border-orange-600">
                    <h3 className="text-xl font-bold text-white mb-4">Step 2: Connect Cardano Wallet</h3>
                    <p className="text-gray-300 mb-4">Connect for ADA distributions</p>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <button
                        onClick={() => connectCardanoWallet('vespr')}
                        className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition-colors"
                      >
                        {cardanoWallet === 'vespr' ? '✓ Vespr' : 'Vespr'}
                      </button>
                      <button
                        onClick={() => connectCardanoWallet('eternl')}
                        className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition-colors"
                      >
                        {cardanoWallet === 'eternl' ? '✓ Eternl' : 'Eternl'}
                      </button>
                      <button
                        onClick={() => connectCardanoWallet('nami')}
                        className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition-colors"
                      >
                        {cardanoWallet === 'nami' ? '✓ Nami' : 'Nami'}
                      </button>
                      <button
                        onClick={() => connectCardanoWallet('flint')}
                        className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition-colors"
                      >
                        {cardanoWallet === 'flint' ? '✓ Flint' : 'Flint'}
                      </button>
                    </div>

                    {adaAddress && (
                      <div className="bg-gray-900 rounded-lg p-3 border border-orange-500">
                        <p className="text-xs text-orange-300 mb-1">Connected Address ({cardanoWallet}):</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono text-white break-all flex-1">{adaAddress}</p>
                          <button
                            onClick={() => navigator.clipboard.writeText(adaAddress)}
                            className="p-2 bg-orange-700 rounded hover:bg-orange-600"
                          >
                            <Copy size={14} className="text-white" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Discord */}
                  <div className="bg-gray-800 rounded-xl p-6 border-2 border-green-600">
                    <h3 className="text-xl font-bold text-white mb-4">Step 3: Discord (Optional)</h3>
                    <input
                      type="text"
                      value={discordUsername}
                      onChange={(e) => setDiscordUsername(e.target.value)}
                      placeholder="username#1234"
                      className="w-full px-4 py-3 bg-gray-900 border-2 border-green-600 rounded-lg text-white"
                    />
                  </div>

                  {/* Submit Button */}
                  {btcAddress && adaAddress && (
                    <button
                      onClick={submitLinkage}
                      className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-orange-600 text-white rounded-xl font-bold text-lg hover:from-purple-500 hover:to-orange-500 transition-all"
                    >
                      Submit Wallet Linkage
                    </button>
                  )}

                  {/* Existing Linkages */}
                  {linkages.length > 0 && (
                    <div className="bg-gray-800 rounded-xl p-6 border-2 border-blue-600 mt-6">
                      <h3 className="text-xl font-bold text-white mb-4">Your Linked Wallets ({linkages.length})</h3>
                      <div className="space-y-3">
                        {linkages.map((linkage, index) => (
                          <div key={index} className="bg-gray-900 rounded-lg p-4 border border-blue-500">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <p className="text-xs text-purple-300 mb-1">Bitcoin ({linkage.btcWallet})</p>
                                <p className="text-xs font-mono text-white break-all">{linkage.btcAddress}</p>
                              </div>
                              <div>
                                <p className="text-xs text-orange-300 mb-1">Cardano ({linkage.cardanoWallet})</p>
                                <p className="text-xs font-mono text-white break-all">{linkage.adaAddress}</p>
                              </div>
                            </div>
                            {linkage.discordUsername && (
                              <p className="text-xs text-green-300 mt-2">Discord: {linkage.discordUsername}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-2">Linked: {new Date(linkage.timestamp).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-8 text-center text-orange-300 text-sm">
              <p>HPEC DAO • 267651.bitmap • Powered by Ordinals</p>
            </div>
          </div>
      </div>
      );
}