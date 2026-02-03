
export interface Address {
  region: string;
  city: string;
  street: string;
  number: string;
  zip: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ClientFile {
  id: string;
  name: string;
  type: string;
  content: string; // Base64 or Blob URL
}

export interface Reminder {
  id: string;
  text: string;
  alertDate: string; // ISO string
  completed: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  type: 'dare' | 'avere';
  date: string;
  description: string;
  alertDate?: string;
}

export interface ClientEvent {
  id: string;
  type: 'appointment' | 'note' | 'deadline';
  date: string; // ISO Date (YYYY-MM-DD)
  title: string;
  description?: string;
}

export interface Client {
  id: string;
  companyName: string;
  firstName: string;
  lastName: string;
  address: Address;
  coords: Coordinates;
  vatId: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  logo?: string;
  notes?: string;
  files: ClientFile[];
  transactions: Transaction[];
  reminders: Reminder[];
  events?: ClientEvent[]; // New property for Calendar
  createdAt: string;
}

export interface RouteStop {
  clientId: string;
  scheduledTime: string;
  notes?: string;
}

export interface Tour {
  id: string;
  name: string;
  date: string;
  stops: RouteStop[];
  status?: 'planned' | 'completed';
}
