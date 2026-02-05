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

export const App: React.FC = () => {

    // --- FIX IOS: STATI FORM AGGIUNTA CLIENTE SPOSTATI QUI ---
  const [newClientFormData, setNewClientFormData] = useState<Partial<Client>>({
      companyName: '', firstName: '', lastName: '', vatId: '', phone: '', whatsapp: '', email: '', website: '',
      address: { street: '', number: '', city: '', zip: '', region: '' },
      notes: ''
  });
  const [newClientInitialBalance, setNewClientInitialBalance] = useState<{type: 'dare'|'avere', amount: string, desc: string}>({
       type: 'dare', amount: '', desc: 'Saldo precedente' 
  });
  const [newClientTempLogo, setNewClientTempLogo] = useState<string | null>(null);
  const [isGenNewLogo, setIsGenNewLogo] = useState(false);

  // Funzioni di supporto per il nuovo form
  const updateNewClientAddr = (f: keyof Address, v: string) => {
      setNewClientFormData(prev => ({ ...prev, address: { ...prev.address!, [f]: v } }));
  };

  const generateNewClientLogo = async () => {
        if (!newClientFormData.companyName) return alert("Inserisci prima il nome dell'azienda!");
        setIsGenNewLogo(true);
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || localStorage.getItem('haircrm_gm_key') || "" });
          const prompt = `Minimalistic professional logo for hair salon '${newClientFormData.companyName}'. Elegant, modern, white background.`;
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: { role: 'user', parts: [{ text: prompt }] } as any 
          });
          // Nota: Simuliamo il successo se l'API non risponde con immagine diretta per evitare crash
          // In produzione servirebbe l'API imagen o un placeholder
        } catch (e) { console.error(e); }
        finally { setIsGenNewLogo(false); }
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
            coords: { lat: 41.9028, lng: 12.4964 }, // Default Roma
            notes: newClientFormData.notes || '',
            transactions: [],
             
            logo: newClientTempLogo || undefined,
            
            
           
        files: [],
reminders: [],
createdAt: new Date().toISOString(),
};

        if (newClientInitialBalance.amount && !isNaN(parseFloat(newClientInitialBalance.amount))) {
            newClient.transactions.push({
                id: crypto.randomUUID(),
                date: new Date().toISOString().split('T')[0],
                type: newClientInitialBalance.type,
                amount: parseFloat(newClientInitialBalance.amount),
                description: newClientInitialBalance.desc
            });
        }

        setClients([...clients, newClient]);
        // Reset del form
        setNewClientFormData({ companyName: '', firstName: '', lastName: '', vatId: '', phone: '', whatsapp: '', email: '', website: '', address: { street: '', number: '', city: '', zip: '', region: '' }, notes: '' });
        setNewClientInitialBalance({ type: 'dare', amount: '', desc: 'Saldo precedente' });
        setNewClientTempLogo(null);
        setActiveTab('list');
        alert("Cliente salvato con successo!");
  };

  // --- State Principale ---
  const [clients, setClients] = useState<Client[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [activeTab, setActiveTab] = useState<'list' | 'cards' | 'map' | 'tour' | 'add' | 'settings' | 'tour_selection'>('list');
  
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

        const latlngs: any[] = [];

        tourClients.forEach((client, idx) => {
            const pos = [client.coords.lat, client.coords.lng];
            latlngs.push(pos);

            // Create a numbered icon using HTML
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="background-color: #9333ea; color: white; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; font-weight: bold; font-size: 12px;">${idx + 1}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            L.marker(pos, { icon: icon }).addTo(map).bindPopup(client.companyName);
        });

        // Draw Polyline
        if (latlngs.length > 1) {
            const polyline = L.polyline(latlngs, { color: '#9333ea', weight: 4 }).addTo(map);
            map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
        }
        
        // Force refresh
        setTimeout(() => map.invalidateSize(), 100);
    }

    return () => {
        if (routeMapInstanceRef.current) {
             if (routeMapInstanceRef.current.remove) routeMapInstanceRef.current.remove();
             routeMapInstanceRef.current = null;
        }
    };
  }, [viewingTourRoute, googleMapsApiKey]);


  // --- SETTINGS DRAFT STATE ---
  const [draftSettings, setDraftSettings] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    if (activeTab === 'settings') {
        setDraftSettings({
            googleMapsApiKey,
            cloudProvider,
            sbUrl: sbConfig.url,
            sbKey: sbConfig.key,
            backgroundImage,
            homePlaceholderImage
        });
    }
  }, [activeTab]);

  const hasSettingsChanges = useMemo(() => {
      if (!draftSettings) return false;
      return (
          draftSettings.googleMapsApiKey !== googleMapsApiKey ||
          draftSettings.cloudProvider !== cloudProvider ||
          draftSettings.sbUrl !== sbConfig.url ||
          draftSettings.sbKey !== sbConfig.key ||
          draftSettings.backgroundImage !== backgroundImage ||
          draftSettings.homePlaceholderImage !== homePlaceholderImage
      );
  }, [draftSettings, googleMapsApiKey, cloudProvider, sbConfig, backgroundImage, homePlaceholderImage]);

  const saveSettings = () => {
      if (!draftSettings) return;
      setGoogleMapsApiKey(draftSettings.googleMapsApiKey);
      setCloudProvider(draftSettings.cloudProvider);
      setSbConfig({ url: draftSettings.sbUrl, key: draftSettings.sbKey });
      setBackgroundImage(draftSettings.backgroundImage);
      setHomePlaceholderImage(draftSettings.homePlaceholderImage);
      
      localStorage.setItem('haircrm_sb_url', draftSettings.sbUrl);
      localStorage.setItem('haircrm_sb_key', draftSettings.sbKey);

      alert("✅ Impostazioni Salvate!");
  };

  const cancelSettings = () => {
      setDraftSettings({
          googleMapsApiKey,
          cloudProvider,
          sbUrl: sbConfig.url,
          sbKey: sbConfig.key,
          backgroundImage,
          homePlaceholderImage
      });
  };

  useEffect(() => {
    localStorage.setItem('haircrm_cloud_provider', cloudProvider);
  }, [cloudProvider]);

  useEffect(() => {
    localStorage.setItem('haircrm_gm_key', googleMapsApiKey);
  }, [googleMapsApiKey]);

  useEffect(() => {
    if (selectedClient) {
      setTempClient(JSON.parse(JSON.stringify(selectedClient)));
    } else {
      setTempClient(null);
    }
  }, [selectedClient]);

  const supabase = useMemo(() => {
    if (cloudProvider === 'supabase' && sbConfig.url && sbConfig.key) {
        try {
            return createClient(sbConfig.url, sbConfig.key);
        } catch(e) { console.error("Invalid Supabase Config"); return null; }
    }
    return null;
  }, [cloudProvider, sbConfig.url, sbConfig.key]);
  
  const [isListening, setIsListening] = useState(false);
  const importExcelInputRef = useRef<HTMLInputElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const lastSyncRef = useRef<string>('');

  // --- GPS Tracking Real-time ---
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus('active');
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // --- Caricamento Dati ---
  useEffect(() => {
    const loadData = async () => {
      // Changed keys to _v2 to ensure clean start without mock data
      const localClients = localStorage.getItem('haircrm_clients_v2');
      const localTours = localStorage.getItem('haircrm_tours_v2');
      const localBg = localStorage.getItem('haircrm_bg');
      
      let loadedClients: Client[] = [];
      if (localClients) loadedClients = JSON.parse(localClients);
      
      if (localTours) setTours(JSON.parse(localTours));
      if (localBg) setBackgroundImage(localBg);

      // Removed block that injected fake events here.
      // List will now be empty if no data in local storage or supabase.
      
      setClients(loadedClients);

      if (supabase) {
        setSyncStatus('syncing');
        try {
          const { data, error } = await supabase.from('app_state').select('data').single();
          if (data && data.data) {
            const cloudData = data.data;
            if (cloudData.clients) setClients(cloudData.clients);
            if (cloudData.tours) setTours(cloudData.tours);
            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 3000);
          } else {
             setSyncStatus('idle');
          }
        } catch (e) { setSyncStatus('error'); }
      }
    };
    loadData();
  }, [supabase]); 

  // --- Salvataggio Dati ---
  useEffect(() => {
    const saveData = async () => {
      // Saving to new _v2 keys
      localStorage.setItem('haircrm_clients_v2', JSON.stringify(clients));
      localStorage.setItem('haircrm_tours_v2', JSON.stringify(tours));
      if (backgroundImage) localStorage.setItem('haircrm_bg', backgroundImage);
      localStorage.setItem('haircrm_home_img', homePlaceholderImage);

      if (supabase) {
        const currentState = JSON.stringify({ clients, tours });
        if (currentState === lastSyncRef.current) return;
        
        setSyncStatus('syncing');
        const timeoutId = setTimeout(async () => {
          try {
            const { error } = await supabase.from('app_state').upsert({ 
              id: 'global_user_data',
              data: { clients, tours },
              updated_at: new Date().toISOString()
            });
            if (!error) {
              lastSyncRef.current = currentState;
              setSyncStatus('success');
              setTimeout(() => setSyncStatus('idle'), 2000);
            } else { setSyncStatus('error'); }
          } catch (e) { setSyncStatus('error'); }
        }, 2000);
        return () => clearTimeout(timeoutId);
      }
    };
    saveData();
  }, [clients, tours, backgroundImage, homePlaceholderImage, supabase]);

  const handleForceUpload = async () => {
    if (!supabase) return alert("Configura prima Supabase!");
    setSyncStatus('syncing');
    try {
        const { error } = await supabase.from('app_state').upsert({ 
            id: 'global_user_data',
            data: { clients, tours },
            updated_at: new Date().toISOString()
        });
        if (!error) {
            setSyncStatus('success');
            alert("✅ Dati SALVATI nel Cloud con successo!");
            setTimeout(() => setSyncStatus('idle'), 2000);
        } else {
            throw error;
        }
    } catch(e: any) {
        setSyncStatus('error');
        alert("Errore Salvataggio: " + e.message);
    }
  };

  const handleForceDownload = async () => {
    if (!supabase) return alert("Configura prima Supabase!");
    if(!confirm("Attenzione: Questo sovrascriverà i dati locali con quelli del Cloud. Continuare?")) return;
    setSyncStatus('syncing');
    try {
        const { data, error } = await supabase.from('app_state').select('data').single();
        if (data && data.data) {
            setClients(data.data.clients || []);
            setTours(data.data.tours || []);
            setSyncStatus('success');
            alert("✅ Dati RIPRISTINATI dal Cloud!");
            setTimeout(() => setSyncStatus('idle'), 2000);
        } else {
            alert("Nessun dato trovato nel Cloud.");
            setSyncStatus('idle');
        }
    } catch(e: any) {
        setSyncStatus('error');
        alert("Errore Download: " + e.message);
    }
  };

  const handleExportCalendar = (title: string, date: string, description: string, location: string) => {
      // Basic ICS generation
      const startDate = date.replace(/-/g, '');
      const d = new Date(date);
      d.setDate(d.getDate() + 1);
      const endDate = d.toISOString().split('T')[0].replace(/-/g, '');
      
      const icsMsg = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          `DTSTART;VALUE=DATE:${startDate}`,
          `DTEND;VALUE=DATE:${endDate}`,
          `SUMMARY:${title}`,
          `DESCRIPTION:${description}`,
          `LOCATION:${location}`,
          'END:VEVENT',
          'END:VCALENDAR'
      ].join('\n');

      const blob = new Blob([icsMsg], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', 'evento.ics');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleGoHome = () => {
    setActiveTab('list');
    setSelectedClient(null);
    setTempClient(null);
    setMapInfoClient(null);
  };

  const filteredClients = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(client => 
      client.companyName.toLowerCase().includes(q) ||
      client.address.city.toLowerCase().includes(q) ||
      client.address.region.toLowerCase().includes(q) || 
      client.phone.includes(q) || 
      client.firstName.toLowerCase().includes(q) ||
      client.lastName.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

  const nearbyClients = useMemo(() => {
    if (!userLocation || !isRadarActive) return [];
    return clients
      .map(c => ({ ...c, distance: calculateDistance(userLocation, c.coords) }))
      .filter(c => c.distance <= radarRange)
      .sort((a, b) => a.distance - b.distance);
  }, [clients, userLocation, isRadarActive, radarRange]);

  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Il tuo browser non supporta la ricerca vocale.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.lang = 'it-IT';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  const getBalance = (client: Client) => client.transactions.reduce((acc, t) => t.type === 'dare' ? acc + t.amount : acc - t.amount, 0);

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = utils.sheet_to_json(ws);
      const newClients: Client[] = data.map((row: any) => ({
        id: row['ID'] || crypto.randomUUID(),
        companyName: row['RagioneSociale'] || row['Azienda'] || 'Senza Nome',
        firstName: row['Nome'] || '', lastName: row['Cognome'] || '',
        vatId: row['PartitaIVA'] || '', phone: row['Telefono'] || '',
        whatsapp: row['WhatsApp'] || '', email: row['Email'] || '', website: row['SitoWeb'] || '',
        notes: row['Note'] || '',
        address: { city: row['Citta'] || '', region: row['Provincia'] || '', street: row['Indirizzo'] || '', number: row['Civico'] || '', zip: row['CAP'] || '' },
        coords: { lat: 41.9028 + (Math.random()-0.5)*0.1, lng: 12.4964 + (Math.random()-0.5)*0.1 }, 
        files: [], transactions: [], reminders: [], createdAt: new Date().toISOString()
      }));
      setClients(prev => [...prev, ...newClients]);
      alert(`${newClients.length} clienti importati.`);
      setActiveTab('list');
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleExcelExport = () => {
    const clientsData = clients.map(c => ({
      ID: c.id,
      RagioneSociale: c.companyName,
      Nome: c.firstName,
      Cognome: c.lastName,
      PartitaIVA: c.vatId,
      Telefono: c.phone,
      WhatsApp: c.whatsapp,
      Email: c.email,
      SitoWeb: c.website,
      Citta: c.address.city,
      Provincia: c.address.region,
      Indirizzo: c.address.street,
      Civico: c.address.number,
      CAP: c.address.zip,
      Note: c.notes,
      Latitudine: c.coords.lat,
      Longitudine: c.coords.lng,
      SaldoAttuale: getBalance(c),
      DataCreazione: c.createdAt
    }));

    const toursData = tours.map(t => ({
      ID_Tour: t.id,
      NomeTour: t.name,
      Data: t.date,
      Stato: t.status,
      NumeroFermate: t.stops.length,
      ElencoClienti: t.stops.map(s => {
         const cl = clients.find(c => c.id === s.clientId);
         return cl ? cl.companyName : '???';
      }).join('; ')
    }));

    const wb = utils.book_new();
    const wsClients = utils.json_to_sheet(clientsData);
    const wsTours = utils.json_to_sheet(toursData);

    utils.book_append_sheet(wb, wsClients, "Clienti");
    utils.book_append_sheet(wb, wsTours, "Tour");

    const fileName = `HairCRM_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
    writeFile(wb, fileName);
  };

  const updateTempClientField = (field: keyof Client, value: any) => {
    if (!tempClient) return;
    setTempClient({ ...tempClient, [field]: value });
  };
  
  const updateTempClientAddress = (field: keyof Address, value: string) => {
      if (!tempClient) return;
      setTempClient({ ...tempClient, address: { ...tempClient.address, [field]: value } });
  };

  const handleSaveDetails = () => {
      if (!tempClient) return;
      setClients(prev => prev.map(c => c.id === tempClient.id ? tempClient : c));
      setSelectedClient(null); 
      setTempClient(null);
  };

  const handleDeleteClient = () => {
    if (!tempClient) return;
    const input = window.prompt(`Scrivi ELIMINA per confermare la cancellazione di ${tempClient.companyName}`);
    if (input && input.trim().toUpperCase() === 'ELIMINA') {
        setClients(prev => prev.filter(c => c.id !== tempClient.id));
        setTempClient(null);
        setSelectedClient(null);
    }
  };

  const addTransactionToTemp = (amount: number, type: 'dare' | 'avere', description: string) => {
      if (!tempClient) return;
      const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount, type, description, date: new Date().toISOString()
      };
      setTempClient({ ...tempClient, transactions: [...tempClient.transactions, newTransaction] });
  };

  // --- TOUR EDIT/DELETE HANDLERS ---
  const handleDeleteTour = (id: string) => {
    if (window.confirm('Sei sicuro di voler eliminare questo tour?')) {
      setTours(prev => prev.filter(t => t.id !== id));
    }
  };

  const handleRenameTour = (id: string, currentName: string) => {
    const newName = window.prompt("Inserisci il nuovo nome del tour:", currentName);
    if (newName && newName.trim() !== "") {
      setTours(prev => prev.map(t => t.id === id ? { ...t, name: newName.trim() } : t));
    }
  };

  const handleSaveEditedTour = () => {
    if (editingTour) {
      setTours(prev => prev.map(t => t.id === editingTour.id ? editingTour : t));
      setEditingTour(null);
    }
  };

  const removeStopFromEdit = (index: number) => {
    if (editingTour) {
      const newStops = [...editingTour.stops];
      newStops.splice(index, 1);
      setEditingTour({ ...editingTour, stops: newStops });
    }
  };

  const generateOptimizedItinerary = () => {
    if (tourSelection.length === 0) return;

    let startCoords: Coordinates | null = null;
    
    if (startPoint === 'gps') {
      if (!userLocation) {
        alert("Attiva il GPS per usare 'La mia posizione'!");
        return;
      }
      startCoords = userLocation;
    } else {
      const c = clients.find(cl => cl.id === startClientId);
      if (!c) {
        alert("Seleziona un cliente di partenza.");
        return;
      }
      startCoords = c.coords;
    }

    if (!startCoords) return;

    let remainingClients = clients.filter(c => tourSelection.includes(c.id));
    let sortedStops: RouteStop[] = [];
    let currentLocation = startCoords;

    while (remainingClients.length > 0) {
      let nearestIdx = -1;
      let minDst = Infinity;

      remainingClients.forEach((c, idx) => {
        const dst = calculateDistance(currentLocation, c.coords);
        if (dst < minDst) {
          minDst = dst;
          nearestIdx = idx;
        }
      });

      if (nearestIdx !== -1) {
        const nearest = remainingClients[nearestIdx];
        sortedStops.push({ clientId: nearest.id, scheduledTime: '09:00' });
        currentLocation = nearest.coords;
        remainingClients.splice(nearestIdx, 1);
      }
    }

    const newTour: Tour = {
      id: crypto.randomUUID(),
      name: `Tour Ottimizzato ${new Date(tourDate).toLocaleDateString('it-IT')}`,
      date: tourDate,
      stops: sortedStops,
      status: 'planned'
    };
    
    setTours([...tours, newTour]);
    setTourSelection([]);
    setTourTab('history');
  };

  const handleStartNavigation = () => {
    if (tourSelection.length === 0) {
        alert("Seleziona almeno un cliente.");
        return;
    }

    let originStr = "";
    if (startPoint === 'gps') {
        if(userLocation) originStr = `${userLocation.lat},${userLocation.lng}`;
    } else {
        const c = clients.find(cl => cl.id === startClientId);
        if (c) {
            originStr = `${c.address.street} ${c.address.number}, ${c.address.city}`;
        }
    }

    const selected = clients.filter(c => tourSelection.includes(c.id));
    if(selected.length === 0) return;

    const destinationClient = selected[selected.length - 1];
    const destinationStr = `${destinationClient.address.street} ${destinationClient.address.number}, ${destinationClient.address.city}`;

    const waypointsClients = selected.slice(0, -1);
    const waypointsStr = waypointsClients.map(c => `${c.address.street} ${c.address.number}, ${c.address.city}`).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationStr)}&travelmode=driving`;
    
    if (originStr) {
        url += `&origin=${encodeURIComponent(originStr)}`;
    }
    if (waypointsStr) {
        url += `&waypoints=${encodeURIComponent(waypointsStr)}`;
    }

    window.open(url, '_blank');
  };

  const generateLogoForSelected = async () => {
    if (!tempClient) return;
    setIsGeneratingLogo(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Minimalistic professional logo for hair salon '${tempClient.companyName}'. Elegant, modern, white background.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (part?.inlineData) {
        const logo = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        setTempClient({ ...tempClient, logo });
      }
    } catch (e) { console.error(e); }
    finally { setIsGeneratingLogo(false); }
  };

  // --- MAPPA IBRIDA (Google Maps vs Leaflet/OpenStreetMap) ---
  useEffect(() => {
    if (activeTab !== 'map' || !mapContainerRef.current) return;

    const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
          resolve();
          return;
        }
        const existingScript = document.getElementById('google-maps-script');
        if (existingScript) {
          setTimeout(resolve, 500); 
          return;
        }
        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initGoogleMaps`;
        script.async = true;
        script.defer = true;
        window.initGoogleMaps = () => resolve();
        script.onerror = (e) => reject(e);
        document.head.appendChild(script);
      });
    };

    if (mapInstanceRef.current) {
        if (mapInstanceRef.current.remove) {
             mapInstanceRef.current.remove();
        }
        mapInstanceRef.current = null;
    }
    markersRef.current.forEach(m => {
        if (m.remove) m.remove(); 
        if (m.setMap) m.setMap(null); 
    });
    markersRef.current = [];
    
    if (radarCircleRef.current) {
        if (radarCircleRef.current.remove) radarCircleRef.current.remove(); 
        if (radarCircleRef.current.setMap) radarCircleRef.current.setMap(null); 
        radarCircleRef.current = null;
    }
    
    if (mapContainerRef.current) {
        mapContainerRef.current.innerHTML = '';
    }

    const startLat = userLocation ? userLocation.lat : 41.9028;
    const startLng = userLocation ? userLocation.lng : 12.4964;

    let mapClients = filteredClients;
    if (isRadarActive && userLocation) {
        mapClients = clients.filter(c => calculateDistance(userLocation, c.coords) <= radarRange);
    }

    if (googleMapsApiKey && googleMapsApiKey.length > 10) {
        loadGoogleMapsScript(googleMapsApiKey).then(() => {
            if (!mapContainerRef.current) return;

            const map = new window.google.maps.Map(mapContainerRef.current, {
                center: { lat: startLat, lng: startLng },
                zoom: 10,
                styles: [],
                disableDefaultUI: true 
            });
            mapInstanceRef.current = map;

            if (isRadarActive && userLocation) {
                const circle = new window.google.maps.Circle({
                    strokeColor: "#3b82f6",
                    strokeOpacity: 0.8,
                    strokeWeight: 1,
                    fillColor: "#3b82f6",
                    fillOpacity: 0.1,
                    map: map,
                    center: { lat: userLocation.lat, lng: userLocation.lng },
                    radius: radarRange * 1000,
                });
                radarCircleRef.current = circle;
            }

            mapClients.forEach(client => {
                let lat = client.coords?.lat || (41.9028 + (Math.random() - 0.5) * 0.1);
                let lng = client.coords?.lng || (12.4964 + (Math.random() - 0.5) * 0.1);

                const marker = new window.google.maps.Marker({
                    position: { lat, lng },
                    map: map,
                    title: client.companyName,
                });

                const popupContent = `
                  <div style="font-family: 'Inter', sans-serif; min-width: 220px; padding: 4px;">
                    <h3 style="margin: 0 0 2px 0; font-size: 14px; font-weight: 900; text-transform: uppercase; color: #111827; letter-spacing: -0.025em;">${client.companyName}</h3>
                    <p style="margin: 0 0 12px 0; font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">${client.firstName} ${client.lastName}</p>
                    
                    <div style="display: flex; gap: 8px;">
                      <a href="tel:${client.phone}" title="Chiama" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background-color: #eff6ff; color: #3b82f6; border-radius: 12px; text-decoration: none; border: 1px solid #dbeafe; transition: all 0.2s;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                      </a>
                      
                      <a href="mailto:${client.email}" title="Email" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background-color: #f3f4f6; color: #4b5563; border-radius: 12px; text-decoration: none; border: 1px solid #e5e7eb; transition: all 0.2s;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                      </a>

                      <a href="https://wa.me/${client.whatsapp.replace(/[^0-9]/g, '')}" target="_blank" title="WhatsApp" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background-color: #ecfdf5; color: #10b981; border-radius: 12px; text-decoration: none; border: 1px solid #d1fae5; transition: all 0.2s;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-4.741 1.242 1.265-4.623-.235-.374a9.86 9.86 0 01-1.511-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.888 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.396.015 12.035c0 2.123.554 4.197 1.604 6.007L0 24l6.135-1.61a11.83 11.83 0 005.912 1.586h.005c6.637 0 12.032-5.396 12.036-12.038A11.87 11.87 0 0018.412 1.49z"/></svg>
                  </a>
                </div>
              </div>
            `;

            marker.bindPopup(popupContent);

            markersRef.current.push(marker);
        });

        if (userLocation) {
             const userMarker = new window.google.maps.Marker({
                position: { lat: userLocation.lat, lng: userLocation.lng },
                map: map,
                title: "Tu sei qui",
                icon: {
                    path: window.google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: "#3b82f6",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                }
            });
            const infoWindow = new window.google.maps.InfoWindow({
                content: "Tu sei qui"
            });
            userMarker.addListener("click", () => {
                infoWindow.open(map, userMarker);
            });
            markersRef.current.push(userMarker);
        }
    });
    } else {
        // --- LEAFLET INITIALIZATION (Fallback or Default) ---
        // Ensure container has no previous map
        if (mapContainerRef.current) {
             mapContainerRef.current.innerHTML = '';
        }

        const map = L.map(mapContainerRef.current, {
            center: [startLat, startLng],
            zoom: 10,
            zoomControl: true // FORCE ZOOM CONTROL
        });
        mapInstanceRef.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        // Radar Visual for Leaflet
        if (isRadarActive && userLocation) {
             const circle = L.circle([userLocation.lat, userLocation.lng], {
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                radius: radarRange * 1000,
                weight: 1
            }).addTo(map);
            radarCircleRef.current = circle;
        }

        mapClients.forEach(client => {
            let lat = client.coords?.lat || (41.9028 + (Math.random() - 0.5) * 0.1);
            let lng = client.coords?.lng || (12.4964 + (Math.random() - 0.5) * 0.1);

            const popupContent = `
              <div style="font-family: 'Inter', sans-serif; min-width: 200px; padding: 4px;">
                <strong style="font-size: 14px; text-transform: uppercase;">${client.companyName}</strong><br/>
                <span style="font-size: 11px; color: #666;">${client.address.city}</span>
              </div>
            `;
            const marker = L.marker([lat, lng]).addTo(map).bindPopup(popupContent);
            markersRef.current.push(marker);
        });

        if (userLocation) {
             const userMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
                color: '#ffffff',
                fillColor: '#3b82f6',
                fillOpacity: 1,
                radius: 8,
                weight: 2
            }).addTo(map);
            userMarker.bindPopup("Tu sei qui");
            markersRef.current.push(userMarker);
        }

        // FORCE RENDER FIX: Invalidate size to ensure map renders correctly
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }

    return () => {
        if (mapInstanceRef.current) {
            if (mapInstanceRef.current.remove) mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }
        markersRef.current.forEach(m => {
            if (m.setMap) m.setMap(null); 
        });
        markersRef.current = [];
        if (radarCircleRef.current) {
            if (radarCircleRef.current.remove) radarCircleRef.current.remove();
            if (radarCircleRef.current.setMap) radarCircleRef.current.setMap(null);
            radarCircleRef.current = null;
        }
    };

  }, [activeTab, filteredClients, userLocation, googleMapsApiKey, isRadarActive, radarRange]);

  // --- CALENDAR LOGIC ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1; 
  };

  const allEvents = useMemo(() => {
    const events: { date: string, type: 'appointment' | 'tour' | 'deadline' | 'note', desc: string, clientName?: string, id: string }[] = [];
    
    tours.forEach(t => {
        events.push({ id: t.id, date: t.date, type: 'tour', desc: t.name });
    });

    clients.forEach(c => {
        c.transactions.forEach(t => {
            if(t.alertDate) {
                events.push({ id: t.id, date: t.alertDate, type: 'deadline', desc: `Scadenza: ${t.description}`, clientName: c.companyName });
            }
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

          days.push(
              <div 
                key={day} 
                onClick={() => setSelectedDate(date)}
                className={`h-14 md:h-20 rounded-xl border flex flex-col items-center justify-start py-1 cursor-pointer transition-all relative ${isSelected ? 'border-purple-500 bg-purple-50 shadow-md transform scale-105 z-10' : 'border-gray-100 bg-white hover:border-purple-200'}`}
              >
                  <span className={`text-[10px] font-bold ${isToday ? 'bg-purple-600 text-white w-5 h-5 flex items-center justify-center rounded-full' : 'text-gray-700'}`}>{day}</span>
                  <div className="flex gap-0.5 mt-1 flex-wrap justify-center px-1">
                      {dayEvents.map((evt, idx) => {
                          let color = 'bg-gray-300';
                          if (evt.type === 'appointment') color = 'bg-blue-500';
                          if (evt.type === 'tour') color = 'bg-emerald-500';
                          if (evt.type === 'deadline') color = 'bg-red-500';
                          if (evt.type === 'note') color = 'bg-yellow-400';
                          return <div key={idx} className={`w-1.5 h-1.5 rounded-full ${color}`} />
                      })}
                  </div>
              </div>
          );
      }
      return days;
  };

  // --- Sotto-Componenti ---
  const NavButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 transition-all flex-1 min-w-0">
      <div className={`p-3 rounded-2xl transition-all duration-300 ${active ? 'bg-purple-100 text-purple-600 shadow-sm scale-110' : 'text-gray-300 hover:text-gray-400'}`}>
        {React.cloneElement(icon as any, { className: "w-6 h-6" })}
      </div>
      <span className={`text-[9px] font-black uppercase tracking-widest transition-colors truncate w-full text-center ${active ? 'text-purple-600' : 'text-gray-300'}`}>{label}</span>
    </button>
  );



  return (
    <div className="min-h-screen bg-[#f8fafc] pb-24 font-sans text-gray-800 relative overflow-x-hidden">
      {backgroundImage && <div className="fixed inset-0 z-0 opacity-10 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${backgroundImage})` }} />}
      
      {/* NOTIFICA GHOST GPS */}
      {notification && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900/95 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-500 border border-white/10 pointer-events-none">
            <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]"/>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-50">{notification}</span>
          </div>
      )}

      <div className="relative z-10 max-w-6xl mx-auto p-4 md:p-8">
        <header className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
             {activeTab !== 'list' && (
                <button 
                    onClick={handleGoHome} 
                    className="p-2 bg-gray-900 text-white rounded-xl shadow-lg hover:bg-gray-700 transition-all active:scale-95 flex items-center gap-2"
                >
                    <HomeIcon className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest hidden md:block">Home</span>
                </button>
             )}
             <h1 className="text-2xl font-black uppercase tracking-tighter text-emerald-500">HairCRM <span className="text-gray-400">Pro</span></h1>
          </div>
          <div className="flex items-center gap-3">
             <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${gpsStatus === 'active' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-red-50 border-red-100 text-red-500'}`}>
                <div className={`w-2 h-2 rounded-full ${gpsStatus === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[9px] font-black uppercase tracking-widest">{gpsStatus === 'active' ? 'GPS ON' : 'GPS OFF'}</span>
             </div>
             <button 
                onClick={() => setActiveTab('settings')}
                className={`p-2.5 rounded-full border transition-all ${activeTab === 'settings' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-100 text-gray-400 hover:text-gray-900'}`}
             >
                <SettingsIcon className="w-5 h-5"/>
             </button>
          </div>
        </header>

        {activeTab === 'list' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="relative w-[90%] md:w-[95%] mx-auto">
              <input 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  placeholder="Cerca cliente, città o telefono..." 
                  className="w-full bg-white p-5 pl-14 pr-14 rounded-2xl shadow-sm border border-gray-100 outline-none font-bold text-gray-700" 
              />
              <SearchIcon className="absolute left-5 top-5 text-gray-300 w-6 h-6"/>
              <button 
                onClick={handleVoiceSearch}
                className={`absolute right-5 top-5 transition-all ${isListening ? 'text-red-500 scale-110' : 'text-gray-300 hover:text-purple-600'}`}
              >
                <MicIcon className={`w-6 h-6 ${isListening ? 'animate-pulse' : ''}`}/>
              </button>
            </div>
            
            {searchQuery.trim().length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredClients.map(client => (
                    <div key={client.id} onClick={() => setSelectedClient(client)} className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-50 hover:shadow-xl transition-all cursor-pointer flex items-center gap-4">
                    <div className="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center font-black text-gray-300 overflow-hidden border border-gray-100 shrink-0">
                        {client.logo ? <img src={client.logo} className="w-full h-full object-cover" /> : client.companyName[0]}
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <h3 className="font-black text-gray-900 truncate uppercase text-xs tracking-tight">{client.companyName}</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{client.address.city}</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-xl font-black text-[10px] ${getBalance(client) > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                        €{Math.abs(getBalance(client)).toFixed(0)}
                    </div>
                    </div>
                ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center mt-20 opacity-80">
                    <img src={homePlaceholderImage || DEFAULT_HOME_IMG} alt="Home Placeholder" className="w-64 h-64 object-contain mb-4 drop-shadow-xl" />
                    <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Cerca un cliente per iniziare</p>
                </div>
            )}
          </div>
        )}

        {activeTab === 'cards' && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <div className="flex items-center gap-3 mb-4">
                 <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><UserIcon className="w-6 h-6"/></div>
                 <h2 className="text-2xl font-black uppercase tracking-tight text-gray-900">Archivio Schede</h2>
             </div>
             
             <div className="relative mb-6">
                <input 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                    placeholder="Filtra schede..." 
                    className="w-full bg-white p-4 pl-12 rounded-xl border border-gray-100 outline-none text-sm font-bold text-gray-700" 
                />
                <SearchIcon className="absolute left-4 top-4 text-gray-300 w-5 h-5"/>
             </div>

             <div className="grid gap-6">
               {filteredClients.map(client => (
                 <div key={client.id} className="bg-white rounded-[2.5rem] p-8 shadow-lg border border-gray-100 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                         <FileIcon className="w-32 h-32 text-gray-900 transform rotate-12"/>
                     </div>
                     
                     <div className="relative z-10">
                         <div className="flex gap-6 items-start mb-6">
                             <div className="w-20 h-20 bg-gray-50 rounded-[1.5rem] flex items-center justify-center font-black text-2xl text-gray-300 shadow-inner border border-gray-100 overflow-hidden">
                                 {client.logo ? <img src={client.logo} className="w-full h-full object-cover" /> : client.companyName[0]}
                             </div>
                             <div>
                                 <div className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-widest w-fit mb-2">ID: {client.id.slice(0,6)}</div>
                                 <h3 className="text-xl font-black uppercase tracking-tight text-gray-900 leading-none mb-1">{client.companyName}</h3>
                                 <p className="text-xs font-bold text-gray-400 uppercase">{client.firstName} {client.lastName}</p>
                             </div>
                         </div>

                         <div className="grid grid-cols-2 gap-4 mb-6">
                             <div className="bg-gray-50 p-4 rounded-2xl">
                                 <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-1">Città</span>
                                 <span className="text-sm font-bold text-gray-700 truncate">{client.address.city}</span>
                             </div>
                              <div className="bg-gray-50 p-4 rounded-2xl">
                                 <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-1">Telefono</span>
                                 <span className="text-sm font-bold text-gray-700 truncate">{client.phone}</span>
                             </div>
                         </div>

                         <div className="flex gap-3">
                             <button onClick={() => setSelectedClient(client)} className="flex-1 py-4 bg-gray-900 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-all hover:bg-indigo-600">Apri Dossier</button>
                             <a href={`tel:${client.phone}`} className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-100 transition-colors"><PhoneIcon className="w-5 h-5"/></a>
                             <a href={`https://wa.me/${client.whatsapp}`} target="_blank" className="p-4 bg-green-50 text-green-600 rounded-2xl hover:bg-green-100 transition-colors"><WhatsAppIcon className="w-5 h-5"/></a>
                         </div>
                     </div>
                 </div>
               ))}
               {filteredClients.length === 0 && (
                   <div className="text-center py-10 text-gray-300">
                       <FileIcon className="w-12 h-12 mx-auto mb-2 opacity-50"/>
                       <p className="text-xs font-black uppercase tracking-widest">Nessuna scheda trovata</p>
                   </div>
               )}
             </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="relative h-[72vh] bg-[#e6e8eb] rounded-[2.5rem] overflow-hidden shadow-inner flex flex-col border border-white/60">
             <div ref={mapContainerRef} className="w-full h-full z-0" />
             
             <div className="absolute bottom-8 right-8 z-30 flex flex-col gap-3 pointer-events-none">
                {!googleMapsApiKey && (
                    <div className="bg-white/90 p-2 rounded-lg text-[10px] text-gray-500 shadow-sm pointer-events-auto">
                        Mappa: OpenStreetMap
                    </div>
                )}
             </div>

             <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-2">
                 <button 
                    onClick={() => setShowRadarPanel(!showRadarPanel)}
                    className={`p-3 rounded-full shadow-lg border border-white/50 backdrop-blur-md transition-all active:scale-95 ${isRadarActive ? 'bg-blue-500 text-white' : 'bg-white/90 text-gray-600 hover:bg-white'}`}
                 >
                     <TargetIcon className="w-6 h-6"/>
                 </button>

                 {showRadarPanel && (
                     <div className="bg-white/95 backdrop-blur-xl p-5 rounded-[1.5rem] shadow-2xl border border-gray-100 w-64 animate-in slide-in-from-right-2 duration-200">
                         <div className="flex justify-between items-center mb-4">
                             <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Radar Clienti</span>
                             <div 
                                onClick={() => setIsRadarActive(!isRadarActive)}
                                className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${isRadarActive ? 'bg-blue-500' : 'bg-gray-200'}`}
                             >
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isRadarActive ? 'translate-x-4' : 'translate-x-0'}`} />
                             </div>
                         </div>
                         
                         <div className={`space-y-3 transition-opacity ${isRadarActive ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                             <div className="flex justify-between items-end">
                                 <span className="text-xs font-bold text-gray-700">Raggio</span>
                                 <span className="text-sm font-black text-blue-600">{radarRange} km</span>
                             </div>
                             <input 
                                type="range" 
                                min="1" 
                                max="200" 
                                value={radarRange} 
                                onChange={(e) => setRadarRange(Number(e.target.value))}
                                className="w-full accent-blue-500 h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                             />
                             <div className="flex justify-between text-[8px] font-bold text-gray-300 uppercase tracking-widest">
                                 <span>1 km</span>
                                 <span>200 km</span>
                             </div>
                         </div>
                     </div>
                 )}
             </div>
          </div>
        )}

        {activeTab === 'tour' && (
          <div className="space-y-8 animate-in fade-in duration-500">
             <div className="flex justify-center mb-8">
                <div className="bg-white p-1.5 rounded-full shadow-sm border border-gray-100 flex gap-1">
                   {['PIANIFICATI', 'STORICO', 'CALENDARIO'].map((tab) => {
                      const key = tab === 'PIANIFICATI' ? 'planner' : tab === 'STORICO' ? 'history' : 'calendar';
                      const isActive = tourTab === key;
                      return (
                         <button 
                           key={tab} 
                           onClick={() => setTourTab(key as any)}
                           className={`px-6 py-2.5 rounded-full text-[10px] font-black tracking-widest transition-all ${isActive ? 'bg-purple-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                         >
                           {tab}
                         </button>
                      )
                   })}
                </div>
             </div>

             {tourTab === 'planner' && (
                <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl overflow-hidden">
                   <div className="p-8 pb-4">
                      <div className="flex justify-between items-start mb-6">
                         <div className="flex items-center gap-3">
                             <MapPinIcon className="w-6 h-6 text-purple-600" />
                             <h2 className="text-xl font-black uppercase tracking-tight text-gray-900">Pianifica Percorso</h2>
                         </div>
                         <button className="text-[10px] font-bold text-purple-600 underline underline-offset-4">Come funziona?</button>
                      </div>

                      <div className="space-y-2 mb-6">
                         <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Punto di Partenza (Per calcolo percorso)</label>
                         <div className="flex bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                            <button 
                                onClick={() => setStartPoint('gps')}
                                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${startPoint === 'gps' ? 'bg-white text-purple-600 shadow-sm border border-gray-100' : 'text-gray-400'}`}
                            >
                                La Mia Posizione
                            </button>
                            <button 
                                onClick={() => setStartPoint('client')}
                                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${startPoint === 'client' ? 'bg-white text-purple-600 shadow-sm border border-gray-100' : 'text-gray-400'}`}
                            >
                                Da un Cliente/Sede
                            </button>
                         </div>
                         {startPoint === 'client' && (
                             <select 
                               className="w-full mt-2 bg-gray-50 p-4 rounded-xl text-xs font-bold outline-none border border-gray-100"
                               value={startClientId}
                               onChange={(e) => setStartClientId(e.target.value)}
                             >
                                <option value="">Seleziona cliente di partenza...</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName} ({c.address.city})</option>)}
                             </select>
                         )}
                      </div>

                      <div className="space-y-2 mb-8">
                         <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Data del Tour</label>
                         <div className="relative">
                            <input 
                              type="date" 
                              value={tourDate}
                              onChange={(e) => setTourDate(e.target.value)}
                              className="w-full bg-gray-50 p-5 rounded-2xl font-bold text-gray-800 outline-none border border-gray-100"
                            />
                         </div>
                      </div>
                   </div>

                   <div className="bg-purple-50/50 p-8 min-h-[300px] flex flex-col justify-center border-t border-gray-50">
                      {clients.length === 0 ? (
                          <div className="flex flex-col items-center text-center space-y-4 animate-in fade-in">
                              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm text-purple-200">
                                  <FileIcon className="w-8 h-8" />
                              </div>
                              <h3 className="font-bold text-gray-400 uppercase tracking-wide">Lista Clienti Vuota</h3>
                              <p className="text-[10px] text-gray-400 max-w-[200px]">Crea prima le schede cliente per poter pianificare un tour.</p>
                              <button onClick={() => setActiveTab('add')} className="px-8 py-3 bg-white border border-purple-100 text-purple-600 font-black text-[10px] uppercase rounded-xl shadow-sm hover:bg-purple-50 transition-colors mt-2">
                                  + Aggiungi Nuovo Cliente
                              </button>
                          </div>
                      ) : (
                          <div className="space-y-4 w-full h-full">
                              <div className="flex justify-between items-center mb-2">
                                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Seleziona Clienti da Visitare ({tourSelection.length})</span>
                                  {tourSelection.length > 0 && <button onClick={() => setTourSelection([])} className="text-[9px] text-red-400 font-bold uppercase underline">Deseleziona tutti</button>}
                              </div>
                              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                  {clients.map(c => {
                                      const isSelected = tourSelection.includes(c.id);
                                      return (
                                          <div 
                                            key={c.id} 
                                            onClick={() => setTourSelection(prev => isSelected ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                                            className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${isSelected ? 'bg-white border-purple-200 shadow-md transform scale-[1.01]' : 'bg-white/60 border-transparent hover:bg-white'}`}
                                          >
                                              <div className="flex items-center gap-3">
                                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-black text-[10px] ${isSelected ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-300'}`}>
                                                      {c.companyName[0]}
                                                  </div>
                                                  <div>
                                                      <p className={`text-xs font-bold uppercase ${isSelected ? 'text-gray-900' : 'text-gray-500'}`}>{c.companyName}</p>
                                                      <p className="text-[9px] text-gray-400 uppercase">{c.address.city}</p>
                                                  </div>
                                              </div>
                                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-200'}`}>
                                                  {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                                              </div>
                                          </div>
                                      )
                                  })}
                              </div>
                          </div>
                      )}
                   </div>

                   <div className="p-4 bg-white border-t border-gray-100 grid grid-cols-1 gap-3">
                       <button 
                         onClick={generateOptimizedItinerary}
                         disabled={tourSelection.length === 0}
                         className={`w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.15em] transition-all shadow-xl ${tourSelection.length === 0 ? 'bg-gray-400 text-gray-100 cursor-not-allowed' : 'bg-gray-800 text-white hover:bg-purple-600 active:scale-95'}`}
                       >
                           Genera Itinerario Ottimizzato
                       </button>
                       <button 
                         onClick={handleStartNavigation}
                         disabled={tourSelection.length === 0}
                         className={`w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.15em] transition-all shadow-xl flex items-center justify-center gap-2 ${tourSelection.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}
                       >
                           <MapPinIcon className="w-4 h-4"/> Avvia Navigazione (Google Maps)
                       </button>
                   </div>
                </div>
             )}

             {tourTab === 'history' && (
                <div className="space-y-6 animate-in slide-in-from-right">
                    {tours.length === 0 ? (
                        <div className="text-center py-20 text-gray-300">
                            <CalendarIcon className="w-16 h-16 mx-auto mb-4 opacity-20"/>
                            <p className="text-xs font-black uppercase tracking-widest">Nessun tour nello storico</p>
                        </div>
                    ) : (
                        tours.slice().reverse().map(tour => (
                          <div key={tour.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all">
                              <div className="flex justify-between items-start mb-4 border-b border-gray-50 pb-4">
                                  <div>
                                      <h3 className="font-black text-gray-800 uppercase text-sm">{tour.name}</h3>
                                      <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">{new Date(tour.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <div className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider">{tour.status}</div>
                                      
                                      {/* TASTO MAPPA AGGIUNTO QUI */}
                                      <button 
                                        onClick={() => setViewingTourRoute(tour)}
                                        className="p-2 bg-gray-50 hover:bg-purple-50 text-gray-400 hover:text-purple-600 rounded-lg transition-colors"
                                        title="Vedi Mappa Percorso"
                                      >
                                          <MapPinIcon className="w-4 h-4"/>
                                      </button>

                                      <button 
                                        onClick={() => {
                                            const tourClients = tour.stops.map(s => clients.find(c => c.id === s.clientId)).filter(Boolean);
                                            const desc = tourClients.map(c => c?.companyName).join(', ');
                                            const loc = tourClients[0] ? `${tourClients[0].address.street}, ${tourClients[0].address.city}` : '';
                                            handleExportCalendar(`Tour: ${tour.name}`, tour.date, `Clienti: ${desc}`, loc);
                                        }}
                                        className="p-2 bg-gray-50 hover:bg-purple-50 text-gray-400 hover:text-purple-600 rounded-lg transition-colors"
                                        title="Salva in Calendario"
                                      >
                                          <CalendarIcon className="w-4 h-4"/>
                                      </button>

                                      <button 
                                        onClick={() => handleRenameTour(tour.id, tour.name)}
                                        className="p-2 bg-gray-50 hover:bg-purple-50 text-gray-400 hover:text-purple-600 rounded-lg transition-colors"
                                        title="Rinomina Tour"
                                      >
                                          <EditIcon className="w-4 h-4"/>
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteTour(tour.id)}
                                        className="p-2 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                                        title="Elimina Tour"
                                      >
                                          <TrashIcon className="w-4 h-4"/>
                                      </button>
                                  </div>
                              </div>
                              <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                                  {tour.stops.map((stop, idx) => {
                                      const cl = clients.find(c => c.id === stop.clientId);
                                      return (
                                          <div key={idx} className="flex-none w-32 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                              <div className="flex items-center gap-2 mb-2">
                                                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[10px] font-black text-gray-400 shadow-sm">{idx + 1}</div>
                                                  <span className="text-[9px] font-bold text-gray-400">{stop.scheduledTime}</span>
                                              </div>
                                              <p className="text-[10px] font-bold text-gray-800 truncate">{cl?.companyName || 'Cliente'}</p>
                                              <p className="text-[9px] text-gray-400 truncate">{cl?.address.city}</p>
                                          </div>
                                      )
                                  })}
                              </div>
                          </div>
                        ))
                    )}
                </div>
             )}

             {tourTab === 'calendar' && (
                 <div className="space-y-6 animate-in slide-in-from-right">
                     <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl overflow-hidden p-6">
                         
                         <div className="flex justify-between items-center mb-6">
                             <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 ml-2">
                                 {currentMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
                             </h2>
                             <div className="flex gap-2">
                                 <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><ChevronLeftIcon className="w-5 h-5 text-gray-600"/></button>
                                 <button onClick={() => setCurrentMonth(new Date())} className="p-2 px-4 text-xs font-bold uppercase hover:bg-purple-50 text-purple-600 rounded-xl transition-colors">Oggi</button>
                                 <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><ChevronRightIcon className="w-5 h-5 text-gray-600"/></button>
                             </div>
                         </div>

                         <div className="grid grid-cols-7 mb-2 text-center">
                             {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                                 <div key={d} className="text-[9px] font-black text-gray-400 uppercase tracking-widest py-2">{d}</div>
                             ))}
                         </div>

                         <div className="grid grid-cols-7 gap-1 md:gap-2">
                             {renderCalendar()}
                         </div>

                         <div className="flex flex-wrap gap-3 mt-6 justify-center">
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"/><span className="text-[9px] font-bold text-gray-500 uppercase">Appuntamenti</span></div>
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"/><span className="text-[9px] font-bold text-gray-500 uppercase">Tour</span></div>
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"/><span className="text-[9px] font-bold text-gray-500 uppercase">Scadenze</span></div>
                             <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-yellow-400"/><span className="text-[9px] font-bold text-gray-500 uppercase">Note</span></div>
                         </div>
                     </div>

                     {selectedDate && (
                         <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl overflow-hidden p-6 animate-in slide-in-from-bottom duration-300">
                             <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                                 <div className="w-12 h-12 bg-purple-50 rounded-2xl flex flex-col items-center justify-center text-purple-600 border border-purple-100">
                                     <span className="text-xs font-black uppercase">{selectedDate.toLocaleDateString('it-IT', { month: 'short' }).slice(0,3)}</span>
                                     <span className="text-lg font-black leading-none">{selectedDate.getDate()}</span>
                                 </div>
                                 <h3 className="font-black text-gray-800 uppercase text-sm tracking-wide">Eventi del Giorno</h3>
                             </div>
                             
                             <div className="space-y-3">
                                 {getEventsForDate(selectedDate).length === 0 ? (
                                     <p className="text-center text-[10px] text-gray-400 font-bold uppercase py-4">Nessun evento per questa data.</p>
                                 ) : (
                                     getEventsForDate(selectedDate).map((evt, idx) => (
                                         <div key={idx} className="flex gap-4 p-3 hover:bg-gray-50 rounded-xl transition-colors border border-transparent hover:border-gray-100 items-center">
                                             <div className={`w-1.5 h-full rounded-full shrink-0 ${
                                                 evt.type === 'appointment' ? 'bg-blue-500' : 
                                                 evt.type === 'tour' ? 'bg-emerald-500' : 
                                                 evt.type === 'deadline' ? 'bg-red-500' : 'bg-yellow-400'
                                             }`} />
                                             <div className="flex-1">
                                                 <div className="flex justify-between items-start">
                                                     <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5 block">{evt.type === 'tour' ? 'Tour Pianificato' : evt.clientName || 'Generale'}</span>
                                                     {evt.type === 'deadline' && <span className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">URGENTE</span>}
                                                 </div>
                                                 <h4 className="font-bold text-gray-800 text-sm leading-tight">{evt.desc}</h4>
                                             </div>
                                             <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleExportCalendar(evt.desc, evt.date, evt.clientName || '', '');
                                                }}
                                                className="p-2 text-gray-300 hover:text-purple-600 transition-colors"
                                                title="Salva in Calendario"
                                            >
                                                <CalendarIcon className="w-4 h-4"/>
                                            </button>
                                         </div>
                                     ))
                                 )}
                             </div>
                         </div>
                     )}
                 </div>
             )}
          </div>
        )}

                   {activeTab === 'add' && (
                <div className="max-w-2xl mx-auto bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-8 animate-in slide-in-from-bottom-4 duration-500 mb-24">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                        <h2 className="text-xl font-black uppercase tracking-tighter text-purple-600">Nuovo Cliente</h2>
                        <button onClick={() => setActiveTab('list')} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100"><XIcon className="w-5 h-5 text-gray-400"/></button>
                    </div>

                    <div className="text-center space-y-2">
                         <div className="w-24 h-24 bg-purple-50 rounded-3xl mx-auto flex items-center justify-center mb-4 relative overflow-hidden shadow-inner group cursor-pointer border border-purple-100" onClick={generateNewClientLogo}>
                             {isGenNewLogo ? <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full"/> : 
                              newClientTempLogo ? <img src={newClientTempLogo} className="w-full h-full object-cover" /> :
                              <PlusIcon className="w-8 h-8 text-purple-300 group-hover:scale-110 transition-transform"/>
                             }
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-purple-400 font-bold">Logo Azienda</p>
                    </div>

                    <div className="space-y-5">
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><UserIcon className="h-5 w-5 text-gray-300"/></div>
                            <input 
                                className="w-full bg-gray-50 pl-12 pr-4 py-4 rounded-2xl font-bold text-lg text-gray-800 outline-none focus:ring-2 focus:ring-purple-100 transition-all placeholder:text-gray-300" 
                                placeholder="Nome Azienda / Salone *"
                                value={newClientFormData.companyName}
                                onChange={e => setNewClientFormData(prev => ({...prev, companyName: e.target.value}))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <input className="bg-gray-50 p-4 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-purple-100 placeholder:text-gray-300" placeholder="Nome Titolare" value={newClientFormData.firstName} onChange={e => setNewClientFormData(prev => ({...prev, firstName: e.target.value}))} />
                             <input className="bg-gray-50 p-4 rounded-2xl font-medium text-gray-700 outline-none focus:ring-2 focus:ring-purple-100 placeholder:text-gray-300" placeholder="Cognome" value={newClientFormData.lastName} onChange={e => setNewClientFormData(prev => ({...prev, lastName: e.target.value}))} />
                        </div>

                        <div className="space-y-3 pt-4 border-t border-gray-50">
                             <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Contatti</h3>
                             <input className="w-full bg-gray-50 p-4 rounded-2xl font-medium text-gray-700 outline-none placeholder:text-gray-300" placeholder="Telefono" value={newClientFormData.phone} onChange={e => setNewClientFormData(prev => ({...prev, phone: e.target.value}))} />
                             <input className="w-full bg-gray-50 p-4 rounded-2xl font-medium text-gray-700 outline-none placeholder:text-gray-300" placeholder="Email" value={newClientFormData.email} onChange={e => setNewClientFormData(prev => ({...prev, email: e.target.value}))} />
                        </div>

                        <div className="space-y-3 pt-4 border-t border-gray-50">
                             <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Indirizzo</h3>
                             <div className="grid grid-cols-[2fr_1fr] gap-3">
                                <input className="bg-gray-50 p-4 rounded-2xl font-medium placeholder:text-gray-300" placeholder="Via" value={newClientFormData.address?.street} onChange={e => updateNewClientAddr('street', e.target.value)} />
                                <input className="bg-gray-50 p-4 rounded-2xl font-medium placeholder:text-gray-300" placeholder="N°" value={newClientFormData.address?.number} onChange={e => updateNewClientAddr('number', e.target.value)} />
                            </div>
                            <div className="grid grid-cols-[2fr_1fr] gap-3">
                                <input className="bg-gray-50 p-4 rounded-2xl font-medium placeholder:text-gray-300" placeholder="Città" value={newClientFormData.address?.city} onChange={e => updateNewClientAddr('city', e.target.value)} />
                                <input className="bg-gray-50 p-4 rounded-2xl font-medium placeholder:text-gray-300" placeholder="CAP" value={newClientFormData.address?.zip} onChange={e => updateNewClientAddr('zip', e.target.value)} />
                            </div>
                        </div>

                        <button onClick={handleSaveNewClient} className="w-full bg-black text-white py-4 rounded-2xl font-bold text-lg shadow-xl hover:scale-[1.02] active:scale-95 transition-all mt-6">
                            Salva Cliente
                        </button>
                    </div>
                </div>
            )}


        {activeTab === 'settings' && (
            <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in duration-500 mb-24">
                <header>
                    <h2 className="text-3xl font-black uppercase tracking-tighter text-gray-900">Impostazioni & Extra</h2>
                    <div className="flex items-center gap-2 mt-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${syncStatus === 'success' ? 'bg-emerald-500' : syncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
                        <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{syncStatus === 'syncing' ? 'Sincronizzazione...' : syncStatus === 'success' ? 'Sincronizzato' : 'Offline'}</span>
                    </div>
                </header>

                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl"><MapPinIcon className="w-8 h-8"/></div>
                        <div>
                            <h3 className="text-lg font-black uppercase tracking-tight text-gray-900">Configurazione Mappa</h3>
                            <p className="text-xs text-gray-400 font-bold">Scegli tra OpenStreetMap (Gratis) o Google Maps.</p>
                        </div>
                    </div>
                    
                    <div className="mb-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block mb-2">Google Maps API Key</label>
                        <input 
                            value={draftSettings?.googleMapsApiKey ?? ''} 
                            onChange={e => setDraftSettings(prev => prev ? ({...prev, googleMapsApiKey: e.target.value}) : null)}
                            placeholder="Inserisci la tua API Key (es. AIza...)" 
                            className="w-full bg-gray-50 p-4 rounded-xl font-bold text-gray-700 outline-none border border-gray-200 focus:border-emerald-500 transition-colors text-xs" 
                        />
                         <p className="mt-2 text-[9px] text-gray-400 font-medium">
                            Se il campo è vuoto, verrà utilizzata automaticamente la mappa gratuita <b>OpenStreetMap</b>.
                        </p>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl"><CloudIcon className="w-8 h-8"/></div>
                        <div>
                            <h3 className="text-lg font-black uppercase tracking-tight text-gray-900">Integrazione Cloud</h3>
                            <p className="text-xs text-gray-400 font-bold">Configura Supabase per sincronizzare PC, Tablet e Smartphone.</p>
                        </div>
                    </div>
                    
                    <div className="mb-6">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 block mb-2">Provider Cloud</label>
                        <div className="relative">
                            <select 
                                value={draftSettings?.cloudProvider ?? 'none'}
                                onChange={(e) => setDraftSettings(prev => prev ? ({...prev, cloudProvider: e.target.value as 'none' | 'supabase'}) : null)}
                                className="w-full bg-gray-50 p-4 rounded-xl font-bold text-gray-700 outline-none border border-gray-200 focus:border-blue-500 transition-colors text-xs appearance-none"
                            >
                                <option value="none">Nessuno (Solo Locale)</option>
                                <option value="supabase">Supabase (Sincronizzazione Attiva)</option>
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">▼</div>
                        </div>
                    </div>
                    
                    {draftSettings?.cloudProvider === 'supabase' && (
                        <div className="animate-in fade-in slide-in-from-top-4">
                            <div className="space-y-4 bg-gray-50/50 p-6 rounded-[2rem] border border-gray-100 mb-8">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Supabase Project URL</label>
                                    <input 
                                        value={draftSettings.sbUrl} 
                                        onChange={e => setDraftSettings(prev => prev ? ({...prev, sbUrl: e.target.value}) : null)} 
                                        placeholder="https://xyz.supabase.co" 
                                        className="w-full bg-white p-4 rounded-xl font-bold text-gray-700 outline-none border border-gray-200 focus:border-blue-500 transition-colors text-xs" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Supabase Public API Key</label>
                                    <input 
                                        value={draftSettings.sbKey} 
                                        onChange={e => setDraftSettings(prev => prev ? ({...prev, sbKey: e.target.value}) : null)} 
                                        type="password"
                                        placeholder="eyJh..." 
                                        className="w-full bg-white p-4 rounded-xl font-bold text-gray-700 outline-none border border-gray-200 focus:border-blue-500 transition-colors text-xs" 
                                    />
                                </div>
                                <p className="text-[9px] text-blue-400 font-bold bg-blue-50 p-3 rounded-lg border border-blue-100">
                                    IMPORTANTE: Inserisci le stesse chiavi su TUTTI i dispositivi per vedere i dati aggiornati ovunque.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button onClick={handleForceUpload} className="py-4 bg-blue-600 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2">
                                    <UploadCloudIcon className="w-4 h-4" /> Salva Dati (Upload)
                                </button>
                                <button onClick={handleForceDownload} className="py-4 bg-white text-blue-600 border border-blue-100 font-black rounded-2xl text-[10px] uppercase tracking-widest hover:bg-blue-50 active:scale-95 transition-all flex items-center justify-center gap-2">
                                    <DownloadCloudIcon className="w-4 h-4" /> Scarica Dati (Download)
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center space-y-4 relative overflow-hidden group">
                        <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mb-2"><PaletteIcon className="w-8 h-8"/></div>
                        <h3 className="font-black uppercase tracking-tight text-gray-900">Tema Personalizzato</h3>
                        <p className="text-[10px] text-gray-400 font-bold leading-relaxed px-4">Carica uno sfondo per cambiare il look dell'App.</p>
                        <button onClick={() => themeInputRef.current?.click()} className="w-full py-4 mt-auto bg-purple-600 text-white font-black rounded-xl text-[10px] uppercase shadow-lg shadow-purple-200 hover:scale-105 transition-all">Carica Sfondo</button>
                        <input type="file" ref={themeInputRef} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if(f){ const r=new FileReader(); r.onloadend=()=>setDraftSettings(prev => prev ? ({...prev, backgroundImage: r.result as string}) : null); r.readAsDataURL(f); } }} />
                    </div>

                    <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center space-y-4">
                        <div className="w-16 h-16 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mb-2"><GlobeIcon className="w-8 h-8"/></div>
                        <h3 className="font-black uppercase tracking-tight text-gray-900">Immagine Home</h3>
                        <p className="text-[10px] text-gray-400 font-bold leading-relaxed px-4">URL Immagine placeholder per la schermata principale.</p>
                        <input 
                          value={draftSettings?.homePlaceholderImage ?? ''}
                          onChange={(e) => setDraftSettings(prev => prev ? ({...prev, homePlaceholderImage: e.target.value}) : null)}
                          placeholder="URL Immagine (https://...)" 
                          className="w-full bg-gray-50 p-4 rounded-xl font-bold text-gray-700 outline-none border border-gray-200 focus:border-orange-500 transition-colors text-xs text-center" 
                        />
                    </div>

                    <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center space-y-4">
                        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-2"><DatabaseIcon className="w-8 h-8"/></div>
                        <h3 className="font-black uppercase tracking-tight text-gray-900">Importa Clienti</h3>
                        <p className="text-[10px] text-gray-400 font-bold leading-relaxed px-4">Carica un file Excel (.xlsx) con le colonne: Azienda, Nome, Telefono, Città.</p>
                        <button onClick={() => importExcelInputRef.current?.click()} className="w-full py-4 mt-auto bg-emerald-500 text-white font-black rounded-xl text-[10px] uppercase shadow-lg shadow-emerald-200 hover:scale-105 transition-all">Seleziona File Excel</button>
                        <input type="file" ref={importExcelInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleExcelImport} />
                    </div>

                    <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center space-y-4">
                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-2"><DownloadCloudIcon className="w-8 h-8"/></div>
                        <h3 className="font-black uppercase tracking-tight text-gray-900">Esporta Lista</h3>
                        <p className="text-[10px] text-gray-400 font-bold leading-relaxed px-4">Scarica l'intera lista clienti e i dati associati in formato Excel.</p>
                        <button onClick={handleExcelExport} className="w-full py-4 mt-auto bg-blue-600 text-white font-black rounded-xl text-[10px] uppercase shadow-lg shadow-blue-200 hover:scale-105 transition-all">Scarica Excel</button>
                    </div>
                </div>

                <div className="flex justify-center pt-8 border-t border-gray-200 border-dashed">
                    <button 
                        onClick={() => { if(confirm("SEI SICURO? Questa azione cancellerà tutti i dati LOCALI. Se non hai sincronizzato con il cloud, i dati andranno persi per sempre.")){ localStorage.clear(); window.location.reload(); }}} 
                        className="text-red-400 font-black text-[10px] uppercase tracking-widest hover:text-red-600 hover:underline underline-offset-4 transition-colors flex items-center gap-2"
                    >
                        <TrashIcon className="w-4 h-4"/> Elimina Definitivamente Tutti i Dati
                    </button>
                </div>

                {hasSettingsChanges && (
                    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md shadow-2xl p-3 px-6 rounded-[1.5rem] flex items-center gap-4 z-50 border border-gray-200 animate-in slide-in-from-bottom duration-300">
                         <div className="text-[9px] font-black uppercase text-gray-400 tracking-widest mr-2 hidden md:block">
                            Modifiche in corso...
                         </div>
                         <button 
                            onClick={cancelSettings}
                            className="px-6 py-3 bg-red-50 text-red-500 hover:bg-red-100 font-black rounded-xl text-[10px] uppercase tracking-widest transition-all"
                         >
                            Annulla
                         </button>
                         <button 
                            onClick={saveSettings}
                            className="px-6 py-3 bg-emerald-500 text-white hover:bg-emerald-600 font-black rounded-xl text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-200 transition-all flex items-center gap-2"
                         >
                            <CheckIcon className="w-4 h-4" /> Salva Modifiche
                         </button>
                    </div>
                )}
            </div>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-3xl border-t border-gray-100 z-50 shadow-[0_-20px_60px_rgba(0,0,0,0.1)]">
           <div className="w-[90%] md:w-[95%] mx-auto py-4 flex justify-between items-center">
               <NavButton icon={<HomeIcon/>} label="Home" active={activeTab === 'list'} onClick={() => setActiveTab('list')} />
               <NavButton icon={<UserIcon/>} label="Schede" active={activeTab === 'cards'} onClick={() => setActiveTab('cards')} />
               <div className="-mt-14 mx-2">
                  <button onClick={() => setActiveTab('add')} className="w-20 h-20 rounded-[2.5rem] shadow-2xl bg-gray-900 text-white ring-8 ring-white active:scale-90 transition-all hover:bg-purple-600 flex items-center justify-center">
                    <PlusIcon className="w-10 h-10"/>
                  </button>
               </div>
               <NavButton icon={<MapPinIcon/>} label="Mappa" active={activeTab === 'map'} onClick={() => setActiveTab('map')} />
               <NavButton icon={<CalendarIcon/>} label="Tour" active={activeTab === 'tour'} onClick={() => setActiveTab('tour')} />
           </div>
      </nav>

      {/* --- MODALE EDITING TOUR --- */}
      {editingTour && (
           <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-300">
               <div className="bg-white/95 backdrop-blur-md px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 z-50 shadow-sm">
                   <div className="flex items-center gap-2">
                        <button onClick={() => setEditingTour(null)} className="p-2 -ml-2 rounded-xl text-gray-400 hover:bg-gray-50 transition-colors">
                            <XIcon className="w-6 h-6"/>
                        </button>
                        <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Modifica Tour</span>
                   </div>
                   <button 
                    onClick={handleSaveEditedTour}
                    className="px-6 py-3 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-purple-200 active:scale-95 transition-all flex items-center gap-2"
                   >
                       <CheckIcon className="w-4 h-4" /> Salva
                   </button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 pb-24 custom-scrollbar">
                   <div className="space-y-4">
                       <div>
                           <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1">Nome del Tour</label>
                           <input 
                               className="w-full text-2xl font-black text-gray-900 bg-transparent border-b-2 border-gray-100 focus:border-purple-500 outline-none pb-2 transition-colors uppercase tracking-tight placeholder:text-gray-200" 
                               value={editingTour.name} 
                               onChange={e => setEditingTour({...editingTour, name: e.target.value})}
                               placeholder="NOME TOUR"
                           />
                       </div>
                       <div>
                           <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1">Data</label>
                           <input 
                               type="date"
                               className="w-full bg-gray-50 p-4 rounded-xl font-bold text-gray-700 outline-none border border-transparent focus:border-purple-200 focus:bg-white transition-all" 
                               value={editingTour.date} 
                               onChange={e => setEditingTour({...editingTour, date: e.target.value})}
                           />
                       </div>
                   </div>

                   <div className="space-y-4">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 border-b border-gray-100 pb-2">Lista Fermate ({editingTour.stops.length})</h3>
                        <div className="space-y-3">
                            {editingTour.stops.length === 0 ? (
                                <p className="text-center text-xs text-gray-400 font-bold py-10">Nessuna fermata in questo tour.</p>
                            ) : (
                                editingTour.stops.map((stop, idx) => {
                                    const cl = clients.find(c => c.id === stop.clientId);
                                    return (
                                        <div key={idx} className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-[10px] font-black text-gray-400 shadow-sm shrink-0">
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-gray-800 text-sm truncate">{cl?.companyName || 'Cliente rimosso'}</p>
                                                <p className="text-[10px] text-gray-400 uppercase tracking-wide truncate">{cl?.address.city}</p>
                                            </div>
                                            <button 
                                                onClick={() => removeStopFromEdit(idx)}
                                                className="p-3 bg-white text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors shadow-sm"
                                                title="Rimuovi fermata"
                                            >
                                                <TrashIcon className="w-4 h-4"/>
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                   </div>
               </div>
           </div>
      )}

      {/* --- MODALE VISUALIZZAZIONE PERCORSO TOUR (ISOLATO) --- */}
      {viewingTourRoute && (
           <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-300">
               <div className="bg-white/95 backdrop-blur-md px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 z-50 shadow-sm">
                   <div className="flex items-center gap-2">
                        <button onClick={() => setViewingTourRoute(null)} className="p-2 -ml-2 rounded-xl text-gray-400 hover:bg-gray-50 transition-colors">
                            <XIcon className="w-6 h-6"/>
                        </button>
                        <div>
                            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest block">Mappa Percorso</span>
                            <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight leading-none">{viewingTourRoute.name}</h3>
                        </div>
                   </div>
               </div>
               
               <div className="flex-1 relative bg-gray-100">
                   <div ref={routeMapRef} className="absolute inset-0 w-full h-full z-0" />
                   
                   {/* Legend Overlay */}
                   <div className="absolute bottom-8 left-8 z-10 bg-white/90 backdrop-blur p-4 rounded-2xl shadow-lg border border-white/50 max-w-[200px]">
                        <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">Legenda</h4>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-purple-600 rounded-full border-2 border-white shadow-sm"/>
                            <span className="text-[10px] font-bold text-gray-600">Fermate</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-8 h-1 bg-purple-600 rounded-full"/>
                            <span className="text-[10px] font-bold text-gray-600">Tragitto</span>
                        </div>
                   </div>
               </div>
           </div>
      )}

      {tempClient && (
           <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in duration-300">
               <div className="bg-white/95 backdrop-blur-md px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 z-50 shadow-sm">
                   <div className="flex items-center gap-2">
                        <button onClick={handleGoHome} className="p-2 mr-1 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors" title="Torna alla Home">
                            <HomeIcon className="w-5 h-5"/>
                        </button>
                        <button onClick={() => setSelectedClient(null)} className="p-2 -ml-2 rounded-xl text-gray-400 hover:bg-gray-50 transition-colors">
                            <XIcon className="w-6 h-6"/>
                        </button>
                        <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Modifica Scheda</span>
                   </div>
                   
                   <div className="flex items-center gap-3">
                       <button 
                            onClick={handleDeleteClient}
                            className="p-2 bg-gray-100 text-red-500 rounded-xl hover:bg-gray-200 transition-colors"
                            title="Elimina Cliente"
                       >
                           <TrashIcon className="w-5 h-5"/>
                       </button>
                       <button 
                        onClick={handleSaveDetails}
                        className="px-6 py-3 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center gap-2"
                       >
                           <CheckIcon className="w-4 h-4" /> Salva
                       </button>
                   </div>
               </div>
               
               <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-10 pb-24 custom-scrollbar">
                   <div className="flex flex-col md:flex-row items-start gap-8">
                        <div className="relative group mx-auto md:mx-0">
                            <div className="w-32 h-32 bg-gray-50 rounded-[2.5rem] border-2 border-gray-100 flex items-center justify-center font-black overflow-hidden shadow-lg relative">
                                {tempClient.logo ? <img src={tempClient.logo} className="w-full h-full object-cover" /> : tempClient.companyName[0]}
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={generateLogoForSelected}>
                                    <RefreshIcon className={`w-8 h-8 text-white ${isGeneratingLogo ? 'animate-spin' : ''}`}/>
                                </div>
                            </div>
                            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-black text-purple-600 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:underline" onClick={generateLogoForSelected}>Cambia Logo</span>
                        </div>
                        
                        <div className="flex-1 w-full space-y-4">
                            <div className="space-y-1">
                                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1">Ragione Sociale</label>
                                <input 
                                    className="w-full text-3xl font-black text-gray-900 bg-transparent border-b-2 border-gray-100 focus:border-purple-500 outline-none pb-2 transition-colors uppercase tracking-tight placeholder:text-gray-200" 
                                    value={tempClient.companyName} 
                                    onChange={e => updateTempClientField('companyName', e.target.value)}
                                    placeholder="NOME AZIENDA"
                                />
                            </div>
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1">Referente</label>
                                    <input 
                                        className="w-full font-bold text-gray-600 bg-gray-50 p-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-100" 
                                        value={tempClient.firstName} 
                                        onChange={e => updateTempClientField('firstName', e.target.value)}
                                        placeholder="Nome"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1 opacity-0">Cognome</label>
                                    <input 
                                        className="w-full font-bold text-gray-600 bg-gray-50 p-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-100" 
                                        value={tempClient.lastName} 
                                        onChange={e => updateTempClientField('lastName', e.target.value)}
                                        placeholder="Cognome"
                                    />
                                </div>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-1">Partita IVA</label>
                                <input 
                                    className="w-full font-bold text-gray-600 bg-gray-50 p-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-100" 
                                    value={tempClient.vatId} 
                                    onChange={e => updateTempClientField('vatId', e.target.value)}
                                />
                            </div>
                        </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className="space-y-5">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                                <MapPinIcon className="w-5 h-5 text-gray-400"/>
                                <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-[0.2em]">Indirizzo & Zona</h3>
                            </div>
                            <div className="space-y-3">
                                <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.address.street} onChange={e => updateTempClientAddress('street', e.target.value)} placeholder="Via/Piazza" />
                                <div className="grid grid-cols-[1fr_2fr] gap-3">
                                    <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.address.zip} onChange={e => updateTempClientAddress('zip', e.target.value)} placeholder="CAP" />
                                    <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.address.city} onChange={e => updateTempClientAddress('city', e.target.value)} placeholder="Città" />
                                </div>
                                <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.address.region} onChange={e => updateTempClientAddress('region', e.target.value)} placeholder="Regione" />
                            </div>
                       </div>

                       <div className="space-y-5">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                                <PhoneIcon className="w-5 h-5 text-gray-400"/>
                                <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-[0.2em]">Recapiti</h3>
                            </div>
                            <div className="space-y-3">
                                <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.phone} onChange={e => updateTempClientField('phone', e.target.value)} placeholder="Telefono" />
                                <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.whatsapp} onChange={e => updateTempClientField('whatsapp', e.target.value)} placeholder="WhatsApp" />
                                <input className="w-full font-bold text-gray-700 bg-gray-50 p-4 rounded-2xl outline-none" value={tempClient.email} onChange={e => updateTempClientField('email', e.target.value)} placeholder="Email" />
                            </div>
                       </div>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                        <div className={`p-8 rounded-[2.5rem] border-2 shadow-sm flex flex-col items-center justify-center text-center space-y-2 ${getBalance(tempClient) > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                            <p className={`text-[11px] font-black uppercase tracking-[0.25em] ${getBalance(tempClient) > 0 ? 'text-red-400' : 'text-emerald-500'}`}>Saldo Attuale</p>
                            <span className={`text-4xl font-black ${getBalance(tempClient) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>€{Math.abs(getBalance(tempClient)).toFixed(2)}</span>
                        </div>
                        <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 flex flex-col gap-4 justify-center shadow-sm">
                            <button onClick={() => { const a = prompt("Importo DARE (€):"); if(a) addTransactionToTemp(parseFloat(a), 'dare', 'Nota manuale'); }} className="w-full py-4 bg-red-100 text-red-600 font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all active:scale-95 shadow-sm hover:bg-red-200">+ Aggiungi Addebito (DARE)</button>
                            <button onClick={() => { const a = prompt("Importo AVERE (€):"); if(a) addTransactionToTemp(parseFloat(a), 'avere', 'Incasso'); }} className="w-full py-4 bg-emerald-100 text-emerald-600 font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all active:scale-95 shadow-sm hover:bg-emerald-200">+ Aggiungi Accredito (AVERE)</button>
                        </div>
                   </div>
                   
                   <div className="flex gap-4">
                        <a href={`tel:${tempClient.phone}`} className="flex-1 py-4 bg-blue-50 text-blue-500 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors"><PhoneIcon className="w-4 h-4"/> Chiama</a>
                        <a href={`https://wa.me/${tempClient.whatsapp}`} target="_blank" className="flex-1 py-4 bg-green-50 text-green-500 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-green-100 transition-colors"><WhatsAppIcon className="w-4 h-4"/> WhatsApp</a>
                   </div>

                   <div className="bg-gray-50 p-8 rounded-[2.5rem] border border-gray-100 space-y-6">
                        <div className="flex items-center gap-3 border-b border-gray-200 pb-5">
                            <FileIcon className="w-5 h-5 text-gray-400"/>
                            <h4 className="text-[11px] font-black uppercase text-gray-500 tracking-[0.15em]">Note & Appunti</h4>
                        </div>
                        <textarea 
                            className="w-full bg-white p-5 rounded-2xl font-medium text-gray-600 outline-none h-40 resize-none shadow-sm focus:ring-2 focus:ring-purple-100" 
                            placeholder="Note sul cliente..."
                            value={tempClient.notes}
                            onChange={e => updateTempClientField('notes', e.target.value)}
                        />
                   </div>

                   <div className="space-y-6">
                        <div className="flex items-center gap-3 border-b border-gray-100 pb-5">
                            <WalletIcon className="w-5 h-5 text-gray-400"/>
                            <h4 className="text-[11px] font-black uppercase text-gray-500 tracking-[0.15em]">Storico Movimenti</h4>
                        </div>
                        <div className="space-y-3">
                            {tempClient.transactions.length === 0 ? <p className="text-[12px] italic text-gray-400 text-center py-6 uppercase tracking-wider">Nessun movimento registrato.</p> : 
                              tempClient.transactions.slice().reverse().map(t => (
                                <div key={t.id} className="bg-white p-4 rounded-2xl flex justify-between items-center shadow-sm border border-gray-50">
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-bold text-gray-800 uppercase tracking-tight">{t.description}</span>
                                        <span className="text-[9px] text-gray-400 font-bold mt-0.5">{new Date(t.date).toLocaleDateString('it-IT')}</span>
                                    </div>
                                    <span className={`text-xs font-black ${t.type === 'dare' ? 'text-red-500' : 'text-emerald-600'}`}>{t.type === 'dare' ? '+' : '-'} €{t.amount.toFixed(2)}</span>
                                </div>
                              ))
                            }
                        </div>
                   </div>
               </div>
           </div>
      )}
    </div>
  );
};

export default App;
