import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { read, utils, writeFile } from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { Client, Tour, Coordinates, Transaction, Address, RouteStop, ClientEvent } from './types';
import { calculateDistance } from './utils/distance';
import { 
  SearchIcon, PlusIcon, MapPinIcon, 
  PhoneIcon, WalletIcon, CalendarIcon, 
  FileIcon, UploadCloudIcon, DownloadCloudIcon, PaletteIcon,
  CloudIcon, RefreshIcon, GlobeIcon, MinusIcon,
  SettingsIcon, XIcon, WhatsAppIcon, DatabaseIcon,
  CheckIcon, TrashIcon, MaximizeIcon, MicIcon, UserIcon,
  SunIcon, HomeIcon, ChevronLeftIcon, ChevronRightIcon, TargetIcon, EditIcon
} from './components/Icons';

// --- CONFIGURAZIONE MAPPA (Leaflet/OSM) ---
declare const L: any; 

declare global {
  interface Window {
    google: any; 
    initGoogleMaps?: () => void;
  }
}

interface SettingsDraft {
    googleMapsApiKey: string;
    cloudProvider: 'none' | 'supabase';
    sbUrl: string;
    sbKey: string;
    backgroundImage: string | null;
    homePlaceholderImage: string;
}

// COMPONENTE NAVBUTTON SPOSTATO FUORI PER EVITARE RE-RENDER
const NavButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 transition-all flex-1 min-w-0">
      <div className={`p-3 rounded-2xl transition-all duration-300 ${active ? 'bg-purple-100 text-purple-600 shadow-sm scale-110' : 'text-gray-300 hover:text-gray-400'}`}>
        {React.cloneElement(icon as any, { className: "w-6 h-6" })}
      </div>
      <span className={`text-[9px] font-black uppercase tracking-widest transition-colors truncate w-full text-center ${active ? 'text-purple-600' : 'text-gray-300'}`}>{label}</span>
    </button>
);

export const App: React.FC = () => {
  // --- State Principale ---
  const [clients, setClients] = useState<Client[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [activeTab, setActiveTab] = useState<'list' | 'cards' | 'map' | 'tour' | 'add' | 'settings' | 'tour_selection'>('list');
  
  // STATO DEL FORM "AGGIUNGI CLIENTE" (SPOSTATO QUI PER EVITARE BUG IOS)
  const [newClientFormData, setNewClientFormData] = useState<Partial<Client>>({
      companyName: '', firstName: '', lastName: '', vatId: '', phone: '', whatsapp: '', email: '', website: '',
      address: { street: '', number: '', city: '', zip: '', region: '' },
      notes: ''
  });
  const [newClientInitialBalance, setNewClientInitialBalance] = useState<{type: 'dare'|'avere', amount: string, desc: string}>({
       type: 'dare', amount: '', desc: 'Saldo precedente' 
  });
  const [newClientTempLogo, setNewClientTempLogo] = useState<string | null>(null);
  const [isGenLogo, setIsGenLogo] = useState(false);

  // Helper per aggiornare l'indirizzo del nuovo cliente
  const updateNewClientAddr = (f: keyof Address, v: string) => {
      setNewClientFormData(prev => ({ 
          ...prev, 
          address: { ...prev.address!, [f]: v } 
      }));
  };

  // Funzione generazione logo spostata qui
  const generateNewClientLogo = async () => {
        if (!newClientFormData.companyName) return alert("Inserisci prima il nome dell'azienda!");
        setIsGenLogo(true);
        try {
          // NOTA: Qui serve la chiave API reale. Assicurati che process.env.API_KEY sia configurato o usa una variabile.
          // Se non hai la chiave qui, questa funzione fallirà. 
          const ai = new GoogleGenAI({ apiKey: "TU_API_KEY_QUI_SE_MANCA" }); // Sostituisci se necessario
          const prompt = `Minimalistic professional logo for hair salon '${newClientFormData.companyName}'. Elegant, modern, white background.`;
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: prompt }] },
            config: { imageConfig: { aspectRatio: "1:1" } }
          });
          const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (part?.inlineData) {
            setNewClientTempLogo(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
          }
        } catch (e) { console.error(e); alert("Errore generazione logo (verifica API Key)"); }
        finally { setIsGenLogo(false); }
  };

  const handleSaveNewClient = () => {
        if (!newClientFormData.companyName) return alert("Nome azienda obbligatorio");
        
        const newClient: Client = {
            id: crypto.randomUUID(),
            companyName: newClientFormData.companyName,
            firstName: newClientFormData.firstName || '',
            lastName: newClientFormData.lastName || '',
            vatId: newClientFormData.vatId || '',
            phone: newClientFormData.phone || '',
            whatsapp: newClientFormData.whatsapp || '',
            email: newClientFormData.email || '',
            website: newClientFormData.website || '',
            address: newClientFormData.address as Address,
            coords: { lat: 0, lng: 0 }, // Geocoding placeholder
            notes: newClientFormData.notes || '',
            transactions: [],
            loyaltyPoints: 0,
            lastVisit: null,
            logo: newClientTempLogo || undefined,
            rating: 0,
            tags: [],
            events: []
        };

        if (newClientInitialBalance.amount && parseFloat(newClientInitialBalance.amount) > 0) {
            newClient.transactions.push({
                id: crypto.randomUUID(),
                date: new Date().toISOString().split('T')[0],
                type: newClientInitialBalance.type,
                amount: parseFloat(newClientInitialBalance.amount),
                description: newClientInitialBalance.desc
            });
        }

        const updatedClients = [...clients, newClient];
        setClients(updatedClients);
        // Reset form
        setNewClientFormData({
          companyName: '', firstName: '', lastName: '', vatId: '', phone: '', whatsapp: '', email: '', website: '',
          address: { street: '', number: '', city: '', zip: '', region: '' },
          notes: ''
        });
        setNewClientInitialBalance({ type: 'dare', amount: '', desc: 'Saldo precedente' });
        setNewClientTempLogo(null);
        setActiveTab('list');
        alert("Cliente aggiunto!");
  };


  // Radar & Mappa
  const [isRadarActive, setIsRadarActive] = useState(false);
  const [showRadarPanel, setShowRadarPanel] = useState(false);
  const [radarRange, setRadarRange] = useState(50); 
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  
  // Ref per Mappa
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const radarCircleRef = useRef<any>(null);

  // Configurazione Mappa Ibrida
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>(
    localStorage.getItem('haircrm_gm_key') || ''
  );

  // STATO TEMPORANEO PER EDITING SCHEDA
  const [tempClient, setTempClient] = useState<Client | null>(null);

  // STATO PER EDITING TOUR
  const [editingTour, setEditingTour] = useState<Tour | null>(null);

  // STATO PER VISUALIZZAZIONE PERCORSO TOUR (MODALE ISOLATO)
  const [viewingTourRoute, setViewingTourRoute] = useState<Tour | null>(null);
  const routeMapRef = useRef<HTMLDivElement>(null);
  const routeMapInstanceRef = useRef<any>(null);

  const [mapInfoClient, setMapInfoClient] = useState<Client | null>(null);

  // Gestione Tour
  const [tourTab, setTourTab] = useState<'planner' | 'history' | 'calendar'>('planner');
  const [tourSelection, setTourSelection] = useState<string[]>([]);
  const [tourDate, setTourDate] = useState(new Date().toISOString().split('T')[0]);
  const [startPoint, setStartPoint] = useState<'gps' | 'client'>('gps');
  const [startClientId, setStartClientId] = useState<string>('');
  
  // CALENDAR STATE
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Impostazioni e Sincronizzazione
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  
  const DEFAULT_HOME_IMG = 'https://cdn-icons-png.flaticon.com/512/3050/3050525.png';
  
  const [homePlaceholderImage, setHomePlaceholderImage] = useState<string>(
    localStorage.getItem('haircrm_home_img') || DEFAULT_HOME_IMG
  );
  
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'success'>('idle');
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
  
  // Configurazione Cloud (Supabase) Dinamica
  const [cloudProvider, setCloudProvider] = useState<'none' | 'supabase'>(
    (localStorage.getItem('haircrm_cloud_provider') as 'none' | 'supabase') || 
    (process.env.SUPABASE_URL ? 'supabase' : 'none')
  );

  const [sbConfig, setSbConfig] = useState({
      url: localStorage.getItem('haircrm_sb_url') || process.env.SUPABASE_URL || '',
      key: localStorage.getItem('haircrm_sb_key') || process.env.SUPABASE_KEY || ''
  });

  // --- GHOST GPS WATCHER STATE ---
  const [notification, setNotification] = useState<string | null>(null);
  const clientsRef = useRef(clients);
  const userLocationRef = useRef(userLocation);

  // Mantieni i ref sincronizzati per il timer
  useEffect(() => { clientsRef.current = clients; }, [clients]);
  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);

  // Timer 60s per controllo prossimità
  useEffect(() => {
      const interval = setInterval(() => {
          if (userLocationRef.current && clientsRef.current.length > 0) {
              // Cerca cliente entro 500m (0.5 km)
              const nearby = clientsRef.current.find(c => calculateDistance(userLocationRef.current!, c.coords) <= 0.5);
              if (nearby) {
                  setNotification(`Cliente Vicino: ${nearby.companyName}`);
                  // Nascondi dopo 5 secondi
                  setTimeout(() => setNotification(null), 5000);
              }
          }
      }, 60000); // 60 secondi
      return () => clearInterval(interval);
  }, []);

  // --- LOGICA MODALE VISUALIZZAZIONE PERCORSO (ISOLATA) ---
  useEffect(() => {
    if (!viewingTourRoute || !routeMapRef.current) return;

    // Cleanup precedente
    if (routeMapInstanceRef.current) {
        if (routeMapInstanceRef.current.remove) routeMapInstanceRef.current.remove(); // Leaflet
        // Google maps doesn't have a strict 'remove' that clears DOM, but we overwrite ref
        routeMapInstanceRef.current = null;
    }
    routeMapRef.current.innerHTML = '';

    const tourClients = viewingTourRoute.stops.map(s => clients.find(c => c.id === s.clientId)).filter(Boolean) as Client[];
    if (tourClients.length === 0) return;

    const startLat = tourClients[0].coords.lat;
    const startLng = tourClients[0].coords.lng;

    if (googleMapsApiKey && googleMapsApiKey.length > 10 && window.google && window.google.maps) {
        // --- GOOGLE MAPS IN MODAL ---
        const map = new window.google.maps.Map(routeMapRef.current, {
            center: { lat: startLat, lng: startLng },
            zoom: 12,
            disableDefaultUI: true
        });
        routeMapInstanceRef.current = map;

        const pathCoords: any[] = [];
        const bounds = new window.google.maps.LatLngBounds();

        tourClients.forEach((client, idx) => {
            const pos = { lat: client.coords.lat, lng: client.coords.lng };
            pathCoords.push(pos);
            bounds.extend(pos);

            new window.google.maps.Marker({
                position: pos,
                map: map,
                label: { text: `${idx + 1}`, color: "white", fontWeight: "bold" },
                title: client.companyName
            });
        });

        // Draw Polyline
        const tourPath = new window.google.maps.Polyline({
            path: pathCoords,
            geodesic: true,
            strokeColor: "#9333ea", // Purple
            strokeOpacity: 1.0,
            strokeWeight: 4,
        });
        tourPath.setMap(map);
        map.fitBounds(bounds);

    } else {
        // --- LEAFLET IN MODAL ---
        const map = L.map(routeMapRef.current, { zoomControl: false }).setView([startLat, startLng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        routeMapInstanceRef.current = map;

        const pathCoords: any[] = [];
        tourClients.forEach((client, idx) => {
            const lat = client.coords.lat;
            const lng = client.coords.lng;
            pathCoords.push([lat, lng]);

            const icon = L.divIcon({
                 className: 'custom-div-icon',
                 html: `<div style="background-color: #9333ea; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white;">${idx + 1}</div>`,
                 iconSize: [24, 24],
                 iconAnchor: [12, 12]
            });
            L.marker([lat, lng], { icon }).addTo(map).bindPopup(client.companyName);
        });

        if (pathCoords.length > 1) {
            L.polyline(pathCoords, { color: '#9333ea', weight: 4 }).addTo(map);
            const bounds = L.latLngBounds(pathCoords);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    // Force resize trigger
    setTimeout(() => {
       if (routeMapInstanceRef.current && routeMapInstanceRef.current.invalidateSize) {
           routeMapInstanceRef.current.invalidateSize();
       } else if (window.google && window.google.maps && routeMapInstanceRef.current) {
           window.google.maps.event.trigger(routeMapInstanceRef.current, "resize");
       }
    }, 300);

    return () => {
        // Cleanup handled at start
    };
  }, [viewingTourRoute, googleMapsApiKey]);


  // --- MAPPA PRINCIPALE (Logic) ---
  const filteredClients = useMemo(() => {
    return clients.filter(c => 
      c.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lastName?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [clients, searchQuery]);

  useEffect(() => {
    if (activeTab !== 'map' || !mapContainerRef.current) return;

    // Cleanup Mappa Esistente
    if (mapInstanceRef.current) {
        if (mapInstanceRef.current.remove) mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
    }
    mapContainerRef.current.innerHTML = ''; // Pulisci DOM

    // --- GOOGLE MAPS ---
    if (googleMapsApiKey && googleMapsApiKey.length > 10 && window.google && window.google.maps) {
        const map = new window.google.maps.Map(mapContainerRef.current, {
            center: { lat: 41.9028, lng: 12.4964 },
            zoom: 6,
            disableDefaultUI: true,
            zoomControl: false,
            streetViewControl: false,
            mapTypeControl: false,
            styles: [ /* Stile Dark Opzionale */ ]
        });
        mapInstanceRef.current = map;

        filteredClients.forEach(client => {
            const marker = new window.google.maps.Marker({
                position: { lat: client.coords.lat, lng: client.coords.lng },
                map: map,
                title: client.companyName
            });
            
            marker.addListener("click", () => {
                setMapInfoClient(client); // Apre la card informativa
            });
            markersRef.current.push(marker);
        });

        if (userLocation) {
            new window.google.maps.Marker({
                position: userLocation,
                map: map,
                icon: {
                    path: window.google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: "#3b82f6",
                    fillOpacity: 1,
                    strokeColor: "white",
                    strokeWeight: 2,
                },
                title: "Tu sei qui"
            });
        }
        
    } else {
        // --- LEAFLET ---
        const map = L.map(mapContainerRef.current, {
             zoomControl: false, 
             attributionControl: false 
        }).setView([41.9028, 12.4964], 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        mapInstanceRef.current = map;

        // Custom Icon Marker (semplice)
        filteredClients.forEach(client => {
            const marker = L.marker([client.coords.lat, client.coords.lng])
                .addTo(map)
                .on('click', () => setMapInfoClient(client)); // Apre card info
            markersRef.current.push(marker);
        });

        if (userLocation) {
             L.circleMarker([userLocation.lat, userLocation.lng], {
                color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, radius: 8, weight: 2
            }).addTo(map);
        }

        // FORCE RENDER FIX
        setTimeout(() => map.invalidateSize(), 100);
    }

    return () => {
        // Cleanup markers etc. handled by re-init logic above
    };

  }, [activeTab, filteredClients, userLocation, googleMapsApiKey]);

  // --- CALENDAR LOGIC ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1; 
  };

  const allEvents = useMemo(() => {
    const events: { date: string, type: 'appointment' | 'tour' | 'deadline' | 'note', desc: string, clientName?: string, id: string }[] = [];
    tours.forEach(t => events.push({ id: t.id, date: t.date, type: 'tour', desc: t.name }));
    clients.forEach(c => {
        c.transactions.forEach(t => {
            if(t.alertDate) events.push({ id: t.id, date: t.alertDate, type: 'deadline', desc: `Scadenza: ${t.description}`, clientName: c.companyName });
        });
        c.events?.forEach(e => {
            events.push({ 
                id: e.id, 
                date: e.date, 
                type: e.type === 'deadline' ? 'deadline' : e.type === 'appointment' ? 'appointment' : 'note', 
                desc: e.title, 
                clientName: c.companyName 
            });
        });
    });
    return events;
  }, [clients, tours]);

  const getEventsForDate = (date: Date) => {
      const dateStr = date.toISOString().split('T')[0];
      return allEvents.filter(e => e.date === dateStr);
  };

  const renderCalendar = () => {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const daysInMonth = getDaysInMonth(year, month);
      const firstDay = getFirstDayOfMonth(year, month);
      
      const days = [];
      for (let i = 0; i < firstDay; i++) {
          days.push(<div key={`empty-${i}`} className="h-14 bg-gray-50/30 rounded-lg"></div>);
      }

      for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month, day);
          const dateStr = date.toISOString().split('T')[0];
          const dayEvents = allEvents.filter(e => e.date === dateStr);
          const isSelected = selectedDate && selectedDate.toDateString() === date.toDateString();
          const isToday = new Date().toDateString() === date.toDateString();

          days.p
