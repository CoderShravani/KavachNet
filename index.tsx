import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat } from "@google/genai";
import { auth, db, storage, functions } from './firebase.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    User
} from "firebase/auth";
import { doc, setDoc, getDoc, collection, onSnapshot, query, where, getDocs, addDoc, serverTimestamp, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";


// --- AI & API Key ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const API_BASE_URL = 'http://127.0.0.1:5001/kavachnet-d945f/us-central1/api'; // Firebase emulator URL
const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiYWlkZW5wZWFyY2UiLCJhIjoiY2w0ZHd1NjFoMDBrZTNkbXJ0NzU5ejA3dyJ9.zGjDSg2Pooz6vA3t3w_A-Q'; // Public demo token

// --- TYPES AND CONSTANTS ---
declare global {
  interface Window {
    mapboxgl: any;
  }
}

type Category = 'Mental Health Crisis' | 'Domestic Violence' | 'Medical Emergency' | 'Financial Distress' | 'Natural Disaster' | 'Other';
type ResourceType = 'Hotline' | 'Shelter' | 'Hospital' | 'Counselor' | 'Food Bank' | 'Relief Center';

interface SupportCenter {
  id: string; 
  name: string;
  category: Category;
  lat: number;
  lon: number;
  contact: string;
  type: ResourceType;
  openHours: string;
  rating: number;
  description: string;
  verified: boolean;
}

interface SupportCenterWithDistance extends SupportCenter {
    distance: number;
}

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'responder';
  timestamp: string;
}

interface TriageMessage extends Message {
    category?: Category | null;
    isEmergency?: boolean;
}

interface MapCluster {
    id: string;
    center: { lat: number; lon: number };
    points: SupportCenterWithDistance[];
}

interface CommunityPartner {
    uid: string;
    type: 'individual' | 'organization';
    name: string;
    services: Category[];
    location: string;
    contact: string;
    description: string;
    resourceType: ResourceType;
    openHours: string;
    documentUrl: string; 
    status: 'pending' | 'verified' | 'rejected';
}

interface Volunteer {
    uid: string;
    name: string;
    email: string;
    phone: string;
    skills: string[];
    availability: string;
    interest: string;
    documentUrl: string;
    status: 'pending' | 'verified' | 'rejected';
}

interface Feedback {
    id: string;
    resourceId: string;
    resourceName: string;
    rating: number;
    comment: string;
    timestamp: any; 
}

interface UserLocation {
    lat: number;
    lon: number;
}

type UserProfile = {
    uid: string;
    email: string;
    role: UserRole;
};

interface EmergencyContact {
    id: number;
    name: string;
    relationship: string;
    phone: string;
    email: string;
}

type EmotionTone = 'calm' | 'anxious' | 'distressed' | 'hopeful' | 'default';

// Mock data updated to Juhu, Mumbai, India. Serves as a primary data source for the demo.
const MOCK_SUPPORT_CENTERS: SupportCenter[] = [
    // Mental Health Crisis - Juhu, Mumbai
    { id: 'mock-1', name: 'The Mind Research Foundation', category: 'Mental Health Crisis', lat: 19.1120, lon: 72.8270, contact: '022-2660-5655', type: 'Counselor', openHours: 'Mon-Sat 10am-7pm', rating: 4.8, description: 'Offers professional counseling, therapy, and workshops for various mental health concerns. Confidential and supportive environment.', verified: true },
    { id: 'mock-2', name: 'Mpower - The Foundation', category: 'Mental Health Crisis', lat: 19.1005, lon: 72.8421, contact: '1800-120-820050', type: 'Counselor', openHours: '24/7 Hotline', rating: 4.9, description: 'A holistic mental health institution providing clinical care, counseling, and support for individuals of all ages.', verified: true },
    { id: 'mock-3', name: 'iCALL Psychosocial Helpline', category: 'Mental Health Crisis', lat: 19.1150, lon: 72.8300, contact: '022-2552-1111', type: 'Hotline', openHours: 'Mon-Sat 10am-8pm', rating: 4.7, description: 'A telephone and email-based counseling service run by TISS, offering free psychosocial support.', verified: true },

    // Domestic Violence - Juhu, Mumbai
    { id: 'mock-4', name: 'Majlis Legal Centre', category: 'Domestic Violence', lat: 19.1190, lon: 72.8475, contact: '022-2666-2394', type: 'Shelter', openHours: 'Mon-Fri 10am-5pm', rating: 4.9, description: 'Provides legal aid and social support to women survivors of violence. Located in nearby Andheri.', verified: true },
    { id: 'mock-5', name: 'Stree Mukti Sanghatana (Juhu)', category: 'Domestic Violence', lat: 19.1050, lon: 72.8240, contact: '022-2413-2415', type: 'Shelter', openHours: '24/7', rating: 4.6, description: 'Provides counseling, shelter, and rehabilitation services for women in distress. (Mock Juhu location)', verified: true },

    // Medical Emergency - Juhu, Mumbai
    { id: 'mock-6', name: 'Dr. Balabhai Nanavati Hospital', category: 'Medical Emergency', lat: 19.0986, lon: 72.8395, contact: '022-2626-7500', type: 'Hospital', openHours: '24/7', rating: 4.7, description: 'A multi-speciality hospital with a comprehensive emergency department. Located in nearby Vile Parle.', verified: true },
    { id: 'mock-7', name: 'Cooper Hospital', category: 'Medical Emergency', lat: 19.1035, lon: 72.8344, contact: '022-2620-7254', type: 'Hospital', openHours: '24/7', rating: 4.2, description: 'A major public hospital with a trauma center, serving the local community with emergency medical services.', verified: true },
    { id: 'mock-8', name: 'Arogya Nidhi Hospital', category: 'Medical Emergency', lat: 19.1085, lon: 72.8286, contact: '022-2613-2489', type: 'Hospital', openHours: '24/7', rating: 4.4, description: 'A private hospital in Juhu offering emergency care and various medical specialities.', verified: false },

    // Financial Distress - Juhu, Mumbai
    { id: 'mock-9', name: 'Roti Bank by Mumbai Dabbawala', category: 'Financial Distress', lat: 19.0999, lon: 72.8301, contact: '86527-86527', type: 'Food Bank', openHours: 'Varies', rating: 4.8, description: 'An initiative to provide free meals to those in need. Contact for information on distribution points. (Mock Juhu point)', verified: true },
    { id: 'mock-10', name: 'Akshaya Patra Foundation', category: 'Financial Distress', lat: 19.1250, lon: 72.8350, contact: '1800-425-8622', type: 'Food Bank', openHours: 'Mon-Fri 9am-5pm', rating: 4.9, description: 'Provides food relief and meals to vulnerable communities. (Nearby distribution center)', verified: true },

    // Natural Disaster - Juhu, Mumbai
    { id: 'mock-11', name: 'BMC K West Ward Office', category: 'Natural Disaster', lat: 19.1196, lon: 72.8436, contact: '022-2623-8098', type: 'Relief Center', openHours: 'As needed', rating: 4.3, description: 'The local municipal office coordinating disaster response for the Andheri West and Juhu area.', verified: true },
    { id: 'mock-12', name: 'Juhu Beach Rescue Post', category: 'Natural Disaster', lat: 19.1020, lon: 72.8245, contact: '101', type: 'Relief Center', openHours: '24/7', rating: 4.5, description: 'Coordinates emergency response for coastal incidents and serves as a local point for disaster relief.', verified: true },

    // Other - Juhu, Mumbai
    { id: 'mock-13', name: 'Mumbai Police Helpline', category: 'Other', lat: 19.1074, lon: 72.8258, contact: '100', type: 'Hotline', openHours: '24/7', rating: 4.6, description: 'General emergency helpline for police assistance and public safety concerns.', verified: true },
];


const CATEGORIES: { name: Category; icon: React.ReactNode; description: string }[] = [
    { name: 'Mental Health Crisis', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.624l.259 1.035L18 21.75l.843-.259a3.375 3.375 0 002.456-2.456l-.259-1.035-1.035-.259a3.375 3.375 0 00-2.456-2.456L18 14.25l-.843.259a3.375 3.375 0 00-2.456 2.456l-.259 1.035 1.035.259a3.375 3.375 0 002.456 2.456z" /></svg>, description: 'Talk to someone now.' },
    { name: 'Domestic Violence', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5-1.5-.5M6.75 7.5l-1.5.545M12 12.75a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>, description: 'Find safe shelter.' },
    { name: 'Medical Emergency', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>, description: 'Get medical help.' },
    { name: 'Financial Distress', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.826-1.106-2.2152 0-2.978C10.544 7.66 11.27 7.5 12 7.5c.882 0 1.685.28 2.348.786l.879.659M12 6V4.5m0 15V18" /></svg>, description: 'Find financial support.' },
    { name: 'Natural Disaster', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>, description: 'Aid after disasters.' },
    { name: 'Other', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>, description: 'General help & info.' }
];

const VOLUNTEER_SKILLS = ['Counseling', 'Medical (Basic First Aid)', 'Logistics & Coordination', 'Community Outreach', 'Administrative Support', 'Technical Support'];
const RESOURCE_TYPES: ResourceType[] = ['Hotline', 'Shelter', 'Hospital', 'Counselor', 'Food Bank', 'Relief Center'];


// --- HOOKS ---

/**
 * Custom hook to manage online status and provide offline-first data.
 */
function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}


/**
 * Custom hook for fetching and caching support center resources.
 * Fetches from backend when online, uses fallback mock data otherwise.
 */
function useSupportResources() {
    const [resources, setResources] = useState<SupportCenter[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isOnline = useNetworkStatus();

    useEffect(() => {
        const fetchResources = async () => {
            setLoading(true);
            setError(null);
            if (isOnline) {
                try {
                    const response = await fetch(`${API_BASE_URL}/resources`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data: SupportCenter[] = await response.json();
                    setResources(data.length > 0 ? data : MOCK_SUPPORT_CENTERS);
                } catch (e) {
                    console.error("Failed to fetch resources from backend, using fallback:", e);
                    setError("Could not load the latest resources. Showing available data.");
                    setResources(MOCK_SUPPORT_CENTERS);
                }
            } else {
                console.log("Offline, using fallback resources.");
                setResources(MOCK_SUPPORT_CENTERS);
            }
            setLoading(false);
        };

        fetchResources();
    }, [isOnline]);

    return { resources, loading, error };
}


// --- UTILITY FUNCTIONS ---

/**
 * Calculates the distance between two geographical points.
 */
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

/**
 * Formats a timestamp into a readable time string.
 */
function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Custom hook for managing user's geolocation.
 */
function useGeolocation() {
    const [location, setLocation] = useState<UserLocation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const getLocation = () => {
        if (!navigator.geolocation) {
            setError('Geolocation is not supported by your browser.');
            setStatus('error');
            return;
        }

        setStatus('loading');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocation({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                });
                setStatus('success');
            },
            (err) => {
                let message = 'An unknown error occurred.';
                switch (err.code) {
                    case err.PERMISSION_DENIED:
                        message = 'Location access was denied. Please enable it in your browser settings to find nearby help.';
                        break;
                    case err.POSITION_UNAVAILABLE:
                        message = 'Location information is unavailable.';
                        break;
                    case err.TIMEOUT:
                        message = 'The request to get user location timed out.';
                        break;
                }
                setError(message);
                setStatus('error');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };
    
    useEffect(() => {
        getLocation();
    }, []);

    return { location, error, status, getLocation };
}

// --- ONBOARDING & SPLASH COMPONENTS ---

function SplashScreen({ onFinish }: { onFinish: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onFinish, 2000); // Show splash for 2 seconds
        return () => clearTimeout(timer);
    }, [onFinish]);

    return (
        <div className="splash-screen">
            <div className="splash-content">
                <div className="logo">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                </div>
                <h1>KavachNet</h1>
                <p>Your Shield in Times of Crisis.</p>
            </div>
        </div>
    );
}

const onboardingSlides = [
    {
        icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>,
        title: "Find Help, Fast.",
        text: "Instantly locate verified support centers for any crisis, right when you need it most."
    },
    {
        icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m12 5.25v-1.5m-6-6v-1.5m-6 7.5v-1.5m6-6h-1.5m6 0h-1.5m-6 0h-1.5m-6 0h1.5m6 0h1.5m-6 0h1.5M12 6.75v-1.5m0 7.5v-1.5" /></svg>,
        title: "AI-Powered Guidance",
        text: "Get immediate, compassionate guidance from our AI responder while you connect to human help."
    },
    {
        icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        title: "Verified & Trusted",
        text: "Every resource is verified to ensure you receive safe, reliable, and high-quality support."
    }
];

function OnboardingScreen({ onFinish }: { onFinish: () => void }) {
    const [currentSlide, setCurrentSlide] = useState(0);

    const handleNext = () => {
        if (currentSlide < onboardingSlides.length - 1) {
            setCurrentSlide(currentSlide + 1);
        } else {
            onFinish();
        }
    };

    const slide = onboardingSlides[currentSlide];

    return (
        <div className="onboarding-container">
            <div className="onboarding-content">
                <div className="slide-icon">{slide.icon}</div>
                <h2 className="slide-title">{slide.title}</h2>
                <p className="slide-text">{slide.text}</p>
            </div>
            <nav className="onboarding-nav">
                <div className="slide-dots">
                    {onboardingSlides.map((_, index) => (
                        <div key={index} className={`dot ${index === currentSlide ? 'active' : ''}`} />
                    ))}
                </div>
                <button onClick={handleNext} className="onboarding-btn">
                    {currentSlide < onboardingSlides.length - 1 ? 'Continue' : "Let's Go"}
                </button>
            </nav>
        </div>
    );
}


// --- OFFLINE COMPONENTS ---

function OfflineIndicatorBanner() {
    return (
        <div className="offline-indicator-banner" role="status">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            You are currently offline. Some features may be limited.
        </div>
    );
}

function OfflineScreen({ cachedResources }: { cachedResources: SupportCenter[] }) {
    
    const emergencyHotlines = useMemo(() => {
        return cachedResources.filter(r => 
            r.type === 'Hotline' && ['Mental Health Crisis', 'Domestic Violence', 'Medical Emergency'].includes(r.category)
        ).slice(0, 2); // Show top 2 emergency hotlines
    }, [cachedResources]);

    return (
        <div className="offline-screen">
            <header className="offline-header">
                <div className="offline-indicator">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <span>You're Offline</span>
                </div>
                <h1>Immediate Help Available</h1>
            </header>
            
            <section className="emergency-contacts">
                <h2>Emergency Contacts</h2>
                {emergencyHotlines.map(line => (
                     <a key={line.id} href={`tel:${line.contact}`} className="emergency-call-btn support">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m12 5.25v-1.5m-6-6v-1.5m-6 7.5v-1.5m6-6h-1.5m6 0h-1.5m-6 0h-1.5m-6 0h1.5m6 0h1.5m-6 0h1.5M12 6.75v-1.5m0 7.5v-1.5" /></svg>
                         <div>
                            <strong>{line.name}</strong>
                            <small>{line.contact}</small>
                         </div>
                    </a>
                ))}
            </section>

            <section className="cached-resources-section">
                <h2>Saved Resources</h2>
                 <div className="cached-resources-list">
                    {cachedResources.length > 0 ? (
                        cachedResources.map(resource => (
                            <div key={resource.id} className="cached-resource-card">
                                <div className="info">
                                    <div className="card-title-container">
                                        <h3>{resource.name}</h3>
                                        {resource.verified && (
                                            <span className="verified-badge-list small">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                Verified
                                            </span>
                                        )}
                                    </div>
                                    <p>{resource.category} - {resource.type}</p>
                                </div>
                                <a href={`tel:${resource.contact}`} className="call-button">Call</a>
                            </div>
                        ))
                    ) : (
                        <p>No resources have been cached for offline use yet.</p>
                    )}
                </div>
            </section>
        </div>
    );
}

// --- CORE UI COMPONENTS ---

/**
 * A loading spinner component.
 */
function Spinner() {
    return <div className="spinner" aria-label="Loading"></div>;
}

/**
 * A generic loading screen component.
 */
function LoadingLocationScreen() {
    return (
        <div className="loading-location-screen">
            <Spinner />
            <p>Finding help near you...</p>
        </div>
    );
}

function LocationPermissionDenied({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="location-permission-denied">
            <div className="location-denied-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
            </div>
            <h2>Location Access Denied</h2>
            <p>To find the nearest support centers, KavachNet needs access to your location. Your location data is kept private and is only used to help you.</p>
            <button className="permission-action-btn" onClick={onRetry}>
                Try Again
            </button>
            <p className="small-text">You can still access national hotlines and our AI assistant without sharing your location.</p>
        </div>
    );
}

function LocationStatusBanner({ status, error, onRetry }: { status: 'idle' | 'loading' | 'success' | 'error', error: string | null, onRetry: () => void}) {
    if (status === 'success' || status === 'idle') return null;

    return (
        <div className={`location-status-banner ${status === 'error' ? 'error' : 'info'}`} role="status">
            {status === 'loading' && <div className="spinner-icon"></div>}
            {status === 'error' && (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
            )}
            <span>
                {status === 'loading' ? 'Finding your location...' : error}
            </span>
            {status === 'error' && <button onClick={onRetry}>Retry</button>}
        </div>
    )
}

function ResultsHeader({ onBack }: { onBack: () => void }) {
    return (
        <header className="results-header">
            <button onClick={onBack} className="back-button">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                Back
            </button>
        </header>
    );
}

// --- MAP & LIST COMPONENTS for CrisisDetailPage ---

function getMarkerHTMLForType(type: ResourceType) {
    switch(type) {
        case 'Hospital':
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z" clip-rule="evenodd" /></svg>`;
        case 'Shelter':
             return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" /><path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" /></svg>`;
        case 'Counselor':
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clip-rule="evenodd" /></svg>`;
        case 'Hotline':
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C6.55 22.5 1.5 17.45 1.5 10.5V4.5z" clip-rule="evenodd" /></svg>`;
        case 'Food Bank':
             return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12.562 15.244a10.467 10.467 0 01-1.125 0C9.68 15.116 9 14.39 9 13.5V3a.75.75 0 00-1.5 0v10.5c0 1.454.895 2.705 2.219 3.141.442.146.903.22 1.374.22a10.467 10.467 0 011.125 0c1.764-.127 3.09-1.748 3.09-3.611V3a.75.75 0 00-1.5 0v10.5c0 .89-.68 1.616-1.438 1.744z" /><path d="M12 2.25a.75.75 0 01.75.75v18a.75.75 0 01-1.5 0V3A.75.75 0 0112 2.25z" /></svg>`;
        case 'Relief Center':
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm11.378-3.917c-.882-1.025-2.867-1.025-3.75 0l-2.83 3.298c-.463.538-.386 1.36.171 1.766L12 17.25l4.781-3.153c.557-.406.635-1.228.17-1.766l-2.83-3.298z" clip-rule="evenodd" /></svg>`;
        default:
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" /></svg>`;
    }
}


function MapView({ centers, userLocation, onMarkerClick, enableClustering = false }: { centers: SupportCenterWithDistance[], userLocation: UserLocation, onMarkerClick: (centerId: string) => void, enableClustering?: boolean }) {
    const mapContainer = useRef<HTMLDivElement | null>(null);
    const map = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const routesRef = useRef<string[]>([]);

    useEffect(() => {
        if (map.current || !mapContainer.current) return; // Initialize only once

        try {
            if (typeof window.mapboxgl === 'undefined' || window.mapboxgl.accessToken === null) {
                console.error("Mapbox GL JS not loaded or access token is missing.");
                return;
            }

            window.mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
            map.current = new window.mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/streets-v11',
                center: [userLocation.lon, userLocation.lat],
                zoom: 12
            });
            
            map.current.on('load', () => {
                 // Add user location marker
                new window.mapboxgl.Marker({ color: '#E74C3C' })
                .setLngLat([userLocation.lon, userLocation.lat])
                .setPopup(new window.mapboxgl.Popup().setText("Your Starting Point"))
                .addTo(map.current);

                if (enableClustering) {
                    map.current.addSource('resources', {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: [] },
                        cluster: true,
                        clusterMaxZoom: 14,
                        clusterRadius: 50
                    });

                    map.current.addLayer({
                        id: 'clusters',
                        type: 'circle',
                        source: 'resources',
                        filter: ['has', 'point_count'],
                        paint: {
                            'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'],
                            'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40]
                        }
                    });

                    map.current.addLayer({
                        id: 'cluster-count',
                        type: 'symbol',
                        source: 'resources',
                        filter: ['has', 'point_count'],
                        layout: {
                            'text-field': '{point_count_abbreviated}',
                            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                            'text-size': 12
                        }
                    });

                    map.current.addLayer({
                        id: 'unclustered-point',
                        type: 'circle',
                        source: 'resources',
                        filter: ['!', ['has', 'point_count']],
                        paint: {
                            'circle-color': '#11b4da',
                            'circle-radius': 8,
                            'circle-stroke-width': 2,
                            'circle-stroke-color': '#fff'
                        }
                    });
                    
                    map.current.on('click', 'clusters', (e: any) => {
                        const features = map.current.queryRenderedFeatures(e.point, { layers: ['clusters'] });
                        const clusterId = features[0].properties.cluster_id;
                        map.current.getSource('resources').getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
                            if (err) return;
                            map.current.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
                        });
                    });

                    map.current.on('click', 'unclustered-point', (e: any) => {
                        const coordinates = e.features[0].geometry.coordinates.slice();
                        const properties = e.features[0].properties;

                        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                        }

                        const popupHTML = `<div class="map-popup">
                            <div class="map-popup-header">
                                <strong>${properties.name}</strong>
                                ${properties.verified ? `<span class="map-popup-verified"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Verified</span>` : ''}
                            </div>
                            <p>${properties.type} - ${parseFloat(properties.distance).toFixed(1)} km away</p>
                            <button onclick="document.getElementById('resource-btn-${properties.id}').click()">View Details</button>
                        </div>`;

                        new window.mapboxgl.Popup()
                            .setLngLat(coordinates)
                            .setHTML(popupHTML)
                            .addTo(map.current);
                    });

                    map.current.on('mouseenter', 'clusters', () => { map.current.getCanvas().style.cursor = 'pointer'; });
                    map.current.on('mouseleave', 'clusters', () => { map.current.getCanvas().style.cursor = ''; });
                    map.current.on('mouseenter', 'unclustered-point', () => { map.current.getCanvas().style.cursor = 'pointer'; });
                    map.current.on('mouseleave', 'unclustered-point', () => { map.current.getCanvas().style.cursor = ''; });
                }
            });
        } catch (error) {
            console.error("MapView crashed during initialization:", error);
            if (mapContainer.current) {
                mapContainer.current.innerHTML = '<div class="map-error-state">Could not load map.</div>';
            }
        }

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        
        // --- CLEANUP ---
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current = [];
        routesRef.current.forEach(routeId => {
            if(map.current.getLayer(routeId)) map.current.removeLayer(routeId);
            if(map.current.getSource(routeId)) map.current.removeSource(routeId);
        });
        routesRef.current = [];

        if (enableClustering) {
            const source = map.current.getSource('resources');
            if (source) {
                 const features = centers.map(center => ({
                    type: 'Feature',
                    properties: { ...center },
                    geometry: {
                        type: 'Point',
                        coordinates: [center.lon, center.lat]
                    }
                }));
                const geojsonData = { type: 'FeatureCollection', features: features };
                source.setData(geojsonData);
            }
        } else {
            centers.forEach(center => {
                // 1. Create custom marker
                const el = document.createElement('div');
                el.className = `custom-marker marker-${center.type.toLowerCase().replace(' ', '-')}`;
                el.innerHTML = getMarkerHTMLForType(center.type);
                
                // 2. Create popup
                const popup = new window.mapboxgl.Popup({ offset: 35 })
                    .setHTML(
                        `<div class="map-popup">
                            <div class="map-popup-header">
                                <strong>${center.name}</strong>
                                ${center.verified ? `<span class="map-popup-verified"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Verified</span>` : ''}
                            </div>
                            <p>${center.type} - ${center.distance.toFixed(1)} km away</p>
                            <button onclick="document.getElementById('resource-btn-${center.id}').click()">View Details</button>
                        </div>`
                    );

                // 3. Add marker to map
                const marker = new window.mapboxgl.Marker(el)
                    .setLngLat([center.lon, center.lat])
                    .setPopup(popup)
                    .addTo(map.current);
                markersRef.current.push(marker);
                
                // 4. Fetch and draw route (async)
                const fetchRoute = async () => {
                    const start = [userLocation.lon, userLocation.lat];
                    const end = [center.lon, center.lat];
                    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`;
                    try {
                        const response = await fetch(url);
                        const data = await response.json();
                        if (data.routes && data.routes.length > 0) {
                            const route = data.routes[0].geometry.coordinates;
                            const geojson = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } };
                            const routeId = `route-${center.id}`;
                            
                            if (map.current && map.current.isStyleLoaded()) {
                                if (!map.current.getSource(routeId)) {
                                    map.current.addSource(routeId, { type: 'geojson', data: geojson });
                                    map.current.addLayer({
                                        id: routeId,
                                        type: 'line',
                                        source: routeId,
                                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                                        paint: { 'line-color': '#5b92e5', 'line-width': 5, 'line-opacity': 0.8 }
                                    });
                                    routesRef.current.push(routeId);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching directions:', error);
                    }
                };
                fetchRoute();
            });
        }
    }, [centers, userLocation, onMarkerClick, enableClustering]);

    return <div ref={mapContainer} className="map-container" />;
}

// --- FEEDBACK COMPONENTS ---

function StarRating({ rating, setRating }: { rating: number, setRating: (r: number) => void }) {
    return (
        <div className="star-rating">
            {[5, 4, 3, 2, 1].map((star) => (
                <React.Fragment key={star}>
                    <input
                        type="radio"
                        id={`star${star}`}
                        name="rating"
                        value={star}
                        checked={rating === star}
                        onChange={() => setRating(star)}
                    />
                    <label htmlFor={`star${star}`}>&#9733;</label>
                </React.Fragment>
            ))}
        </div>
    );
}

function FeedbackForm({ resource, onSubmitSuccess }: { resource: SupportCenter, onSubmitSuccess: () => void }) {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (rating === 0) {
            setError('Please select a rating.');
            return;
        }
        setError('');
        setSubmitting(true);
        try {
            await fetch(`${API_BASE_URL}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    resourceId: resource.id,
                    resourceName: resource.name,
                    rating,
                    comment
                })
            });
            onSubmitSuccess();
        } catch (err) {
            setError('Failed to submit feedback. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form className="feedback-form" onSubmit={handleSubmit}>
            {error && <p className="error-message">{error}</p>}
            <div className="form-group">
                <StarRating rating={rating} setRating={setRating} />
            </div>
            <div className="form-group">
                <textarea
                    placeholder="Share your experience (optional)..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                />
            </div>
            <button type="submit" className="feedback-submit-btn" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
        </form>
    );
}

// --- MAIN PAGE COMPONENTS ---

function HomePage({ onSelectCategory, onStartChat, onStartDemo }: { onSelectCategory: (category: Category) => void, onStartChat: () => void, onStartDemo: () => void }) {
    return (
        <main className="main-app-container">
            <header className="app-header">
                <div className="header-top-row">
                    <h1>KavachNet</h1>
                </div>
                <p className="intro-text">Find immediate, verified support for any crisis.</p>
            </header>

            <section className="actions-container">
                <button className="chat-now-btn" onClick={onStartChat}>
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-0.471l-5.459 2.729a.75.75 0 01-1.004-.823l1.543-4.596A9.037 9.037 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
                    <span>Chat with AI Assistant</span>
                </button>
                <button className="demo-session-btn" onClick={onStartDemo}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
                    <span>View Demo Session</span>
                </button>
            </section>
            
            <section className="category-selector" aria-labelledby="category-title">
                <h2 id="category-title" className="sr-only">Crisis Categories</h2>
                <div className="categories">
                    {CATEGORIES.map(({ name, icon, description }) => (
                        <button key={name} className="category-card" onClick={() => onSelectCategory(name)}>
                            <div className="card-icon">{icon}</div>
                            <div className="card-content">
                                <h3>{name}</h3>
                                <p>{description}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </section>
            
        </main>
    );
}

function HelpfulArticles({ articles, isLoading }: { articles: string, isLoading: boolean}) {
    if (isLoading) {
        return (
            <div className="helpful-articles-loading">
                <Spinner />
                <p>Finding helpful articles...</p>
            </div>
        );
    }
    
    const parsedArticles = useMemo(() => {
        try {
            if (!articles || typeof articles !== 'string') return [];
            return articles
                .split('\n')
                .map(item => {
                    const trimmedItem = item.trim();
                    if (!trimmedItem.startsWith('-') && !trimmedItem.startsWith('*')) {
                        return null;
                    }

                    const content = trimmedItem.substring(1).trim();
                    const titleMatch = content.match(/\*\*(.*?)\*\*/);
                    
                    if (titleMatch && titleMatch[1]) {
                        const title = titleMatch[1];
                        const description = content.replace(`**${title}**`, '').replace(':', '').trim();
                        return { title, description };
                    }
                    
                    const parts = content.split(':');
                    if (parts.length > 1) {
                        const title = parts[0].replace(/\*/g, '').trim();
                        const description = parts.slice(1).join(':').trim();
                        return { title, description };
                    }

                    return null;
                })
                .filter(Boolean);
        } catch (error) {
            console.error("Failed to parse helpful articles:", error, "Raw content:", articles);
            return []; // Return empty array on any parsing error to prevent crashing.
        }
    }, [articles]);

    if (parsedArticles.length === 0) {
        if (!isLoading) {
            return <div className="list-view-empty">No articles found at this time.</div>;
        }
        return null;
    }

    return (
        <div className="helpful-articles">
            {parsedArticles.map((article, index) => (
                <div key={index} className="article-item">
                    <strong>{article.title}</strong>
                    <p>{article.description}</p>
                </div>
            ))}
        </div>
    );
}

function ListView({ centers, onSelect, highlightedId }: { centers: SupportCenterWithDistance[], onSelect: (center: SupportCenter) => void, highlightedId: string | null }) {
    if (!Array.isArray(centers) || centers.length === 0) {
        return <div className="list-view-empty">No nearby centers found for this category.</div>;
    }

    return (
        <div className="support-center-list">
            {centers.map(center => {
                try {
                    // Bulletproofing: Ensure center and its ID exist before rendering.
                    if (!center || !center.id) return null; 

                    return (
                        <button 
                            key={center.id}
                            id={`resource-btn-${center.id}`}
                            className={`support-center-card ${highlightedId === center.id ? 'highlighted' : ''}`}
                            onClick={() => onSelect(center)}
                            aria-label={`View details for ${center.name}, ${center.distance.toFixed(1)} kilometers away`}
                        >
                            <div className="info">
                                <div className="card-title-container">
                                     <h3>{center.name}</h3>
                                     {center.verified && (
                                        <span className="verified-badge-list">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            Verified
                                        </span>
                                     )}
                                </div>
                                <p className="meta-info">{center.type} • {center.openHours}</p>
                                <p className="distance-info">{center.distance.toFixed(1)} km away</p>
                            </div>
                            <div className="card-arrow">
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                            </div>
                        </button>
                    );
                } catch (error) {
                    console.error("Failed to render a list view item:", error, "Item data:", center);
                    return null; // Don't crash the entire list if one item is malformed.
                }
            })}
        </div>
    );
}

function CrisisDetailPage({ category, allResources, onBack, onSelectResource, onStartChat }: { category: Category, allResources: SupportCenter[], onBack: () => void, onSelectResource: (resource: SupportCenter) => void, onStartChat: (message?: string) => void }) {
    const [aiGuidance, setAiGuidance] = useState('');
    const [loadingGuidance, setLoadingGuidance] = useState(true);
    const [additionalResources, setAdditionalResources] = useState('');
    const [loadingAdditional, setLoadingAdditional] = useState(true);
    const [highlightedId, setHighlightedId] = useState<string | null>(null);

    const categoryInfo = CATEGORIES.find(c => c.name === category);
    const juhuLocation: UserLocation = { lat: 19.1074, lon: 72.8258 };

    const categoryTheme: Record<Category, string> = {
        'Mental Health Crisis': 'theme-mental-health',
        'Domestic Violence': 'theme-domestic-violence',
        'Medical Emergency': 'theme-medical-emergency',
        'Financial Distress': 'theme-financial-distress',
        'Natural Disaster': 'theme-natural-disaster',
        'Other': 'theme-other'
    };

    const nearbyResources = useMemo(() => {
        if (!allResources) return [];
        return allResources
            .filter(center => center.category === category)
            .map(center => ({
                ...center,
                distance: getDistance(juhuLocation.lat, juhuLocation.lon, center.lat, center.lon)
            }))
            .sort((a, b) => a.distance - b.distance);
    }, [allResources, category]);

    const nationalHelplines = useMemo(() => {
        return MOCK_SUPPORT_CENTERS.filter(center => 
            center.category === category && center.type === 'Hotline'
        );
    }, [category]);

    useEffect(() => {
        const fetchGuidance = async () => {
            setLoadingGuidance(true);
            try {
                const prompt = `I am facing a ${category}. What are the immediate first steps I should take? Provide 2-3 concise, actionable bullet points. Be calm and reassuring. Wrap key actions in **bold** text.`;
                const response = await ai.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: prompt,
                });
                setAiGuidance(response.text);
            } catch (error) {
                console.error("AI guidance fetch failed:", error);
                setAiGuidance("Could not load AI guidance. Please focus on contacting the helplines below.");
            } finally {
                setLoadingGuidance(false);
            }
        };
        const fetchAdditionalResources = async () => {
            setLoadingAdditional(true);
            try {
                const prompt = `For someone facing a ${category} in India, suggest 2 helpful online articles or official government resources. Provide a title and a very brief (1-sentence) description for each. Format it as a simple list. Example: - **Resource Title:** Brief description.`;
                const response = await ai.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: prompt,
                });
                setAdditionalResources(response.text);
            } catch (error) {
                console.error("AI additional resources fetch failed:", error);
                setAdditionalResources("");
            } finally {
                setLoadingAdditional(false);
            }
        };
        fetchGuidance();
        fetchAdditionalResources();
    }, [category]);

    return (
        <div className={`crisis-detail-page ${categoryTheme[category] || 'theme-other'}`}>
            <ResultsHeader onBack={onBack} />
            <div className="crisis-content">
                <header className="crisis-header">
                    <div className="category-icon-wrapper">{categoryInfo?.icon}</div>
                    <h1>Help for {category}</h1>
                    <p className="crisis-intro">You've taken a brave step by seeking help. Here are some immediate steps and resources to support you.</p>
                </header>

                <section className="ai-guidance-section">
                    <h2>AI-Powered First Steps</h2>
                     {loadingGuidance ? (
                        <div className="ai-guidance-loading">
                            <Spinner/>
                            <p>Getting guidance...</p>
                        </div>
                    ) : (
                        <p dangerouslySetInnerHTML={{ __html: aiGuidance.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }} />
                    )}
                </section>
                
                {nationalHelplines.length > 0 && (
                    <section className="immediate-help-section">
                        <h2>Immediate Help (National Hotlines)</h2>
                        <div className="helpline-grid">
                            {nationalHelplines.map(line => (
                                 <a href={`tel:${line.contact}`} key={line.id} className="helpline-card">
                                    <div>
                                        <strong>{line.name}</strong>
                                        <span>{line.contact}</span>
                                    </div>
                                    <div className="call-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.211-.998-.552-1.348l-5.452-5.452a2.25 2.25 0 00-3.182 0l-3.57 3.57a2.25 2.25 0 01-3.182 0L6.423 9.353a2.25 2.25 0 000-3.182l5.453-5.453C12.333 3.34 12.815 3.13 13.33 3.13h1.372c.621 0 1.125.504 1.125 1.125v2.25" /></svg>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </section>
                )}

                 <section className="nearby-help-section">
                    <h2>Support Centers in Juhu, Mumbai</h2>
                    <div className="nearby-content">
                        <div className="map-wrapper">
                             <MapView 
                                centers={nearbyResources} 
                                userLocation={juhuLocation}
                                onMarkerClick={setHighlightedId}
                            />
                        </div>
                        <div className="list-wrapper">
                             <ListView 
                                centers={nearbyResources} 
                                onSelect={onSelectResource}
                                highlightedId={highlightedId}
                            />
                        </div>
                    </div>
                </section>

                <section className="additional-resources-section">
                    <h2>Helpful Resources & Articles</h2>
                    <HelpfulArticles articles={additionalResources} isLoading={loadingAdditional} />
                </section>
                
                <section className="chat-cta-section">
                     <h2>Feeling Overwhelmed?</h2>
                     <p>Sometimes it helps to talk it through. Our AI responder is available 24/7 to listen and provide guidance in a safe, confidential space.</p>
                     <button className="chat-now-btn" onClick={() => onStartChat(`I need help with a ${category}.`)}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-0.471l-5.459 2.729a.75.75 0 01-1.004-.823l1.543-4.596A9.037 9.037 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
                        Chat with AI Assistant
                    </button>
                </section>
            </div>
        </div>
    );
}

function ResourceDetailPage({ resource, onBack, onStartChat }: { resource: SupportCenter, onBack: () => void, onStartChat: (resourceName: string) => void }) {
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

    return (
        <div className="resource-detail-page">
            <ResultsHeader onBack={onBack} />
            <div className="detail-content">
                <header>
                    <div className="detail-header">
                        <h1 className="detail-name">{resource.name}</h1>
                        {resource.verified && (
                            <span className="verified-badge">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Verified
                            </span>
                        )}
                    </div>
                    <p className="detail-meta">{resource.type} • {resource.category}</p>
                </header>

                <div className="detail-main-actions">
                    <a href={`tel:${resource.contact}`} className="detail-btn call">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.211-.998-.552-1.348l-5.452-5.452a2.25 2.25 0 00-3.182 0l-3.57 3.57a2.25 2.25 0 01-3.182 0L6.423 9.353a2.25 2.25 0 000-3.182l5.453-5.453C12.333 3.34 12.815 3.13 13.33 3.13h1.372c.621 0 1.125.504 1.125 1.125v2.25" /></svg>
                        Call Now
                    </a>
                     <a href={`https://www.google.com/maps/dir/?api=1&destination=${resource.lat},${resource.lon}`} target="_blank" rel="noopener noreferrer" className="detail-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.5-10.5h-7a2.25 2.25 0 00-2.25 2.25v7.5a2.25 2.25 0 002.25 2.25h7a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25z" /></svg>
                        Get Directions
                    </a>
                </div>

                <div className="detail-secondary-actions">
                     <button className="detail-btn-secondary chat" onClick={() => onStartChat(resource.name)}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-0.471l-5.459 2.729a.75.75 0 01-1.004-.823l1.543-4.596A9.037 9.037 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
                        Discuss with AI
                    </button>
                </div>

                <section className="detail-section">
                    <h3>Description</h3>
                    <p>{resource.description || "No description available."}</p>
                </section>
                <section className="detail-section">
                    <h3>Contact Information</h3>
                    <p><strong>Phone:</strong> {resource.contact}</p>
                    <p><strong>Hours:</strong> {resource.openHours}</p>
                </section>
                <section className="detail-section">
                    <h3>Rate This Resource</h3>
                    {feedbackSubmitted ? (
                        <div className="feedback-message">Thank you for your feedback!</div>
                    ) : (
                        <FeedbackForm resource={resource} onSubmitSuccess={() => setFeedbackSubmitted(true)} />
                    )}
                </section>
            </div>
        </div>
    );
}

// --- CHAT & TRIAGE COMPONENTS ---

function ChatScreen({ onExit, initialMessage }: { onExit: () => void, initialMessage?: string }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [emotionTone, setEmotionTone] = useState<EmotionTone>('default');
    const [showExitModal, setShowExitModal] = useState(false);
    const chatRef = useRef<Chat | null>(null);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    
    // Auto-scroll to latest message
    useEffect(() => {
        if (messageListRef.current) {
            messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
        }
    }, [messages]);
    
    // Initialize chat
    useEffect(() => {
        const startChat = async () => {
            const systemInstruction = `You are a compassionate, calming AI crisis responder for KavachNet. Your goal is to provide immediate, safe, and supportive guidance. 
            1.  PRIORITY: If the user mentions self-harm, harm to others, or a life-threatening medical emergency, IMMEDIATELY AND ONLY respond with this exact text: "EMERGENCY: This is a critical situation. Please call 911 or your local emergency number right away." Do not add any other text.
            2.  Listen carefully and validate the user's feelings. Use phrases like "That sounds incredibly difficult," or "It makes sense that you feel that way."
            3.  Keep responses concise, clear, and easy to understand. Use short paragraphs.
            4.  Do not give medical or legal advice. Instead, guide users to professionals.
            5.  Analyze the user's message for emotional tone (calm, anxious, distressed, hopeful) and include it in your response JSON.
            6.  Always respond in JSON format: {"response": "Your text here.", "emotion": "tone_here"}`;
            
            chatRef.current = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: { systemInstruction }
            });

            // Add initial welcome message
            const welcomeMessage: Message = {
                id: Date.now(),
                text: "I'm a compassionate AI responder here to help. I'm listening. How are you feeling right now?",
                sender: 'responder',
                timestamp: formatTime(new Date()),
            };
            setMessages([welcomeMessage]);

            if (initialMessage) {
                 const userMessage: Message = {
                    id: Date.now() + 1,
                    text: initialMessage,
                    sender: 'user',
                    timestamp: formatTime(new Date())
                };
                setMessages(prev => [...prev, userMessage]);
                await sendMessageToAI(initialMessage);
            }
        };
        startChat();
    }, [initialMessage]);

    const sendMessageToAI = async (messageText: string) => {
        if (!chatRef.current) return;
        setIsTyping(true);
        try {
            const result = await chatRef.current.sendMessage({ message: messageText });
            const responseText = result.text.trim();
            
            // Check for emergency phrase first
            if (responseText.startsWith('EMERGENCY:')) {
                 const responderMessage: Message = {
                    id: Date.now(),
                    text: responseText,
                    sender: 'responder',
                    timestamp: formatTime(new Date()),
                };
                setMessages(prev => [...prev, responderMessage]);
                setEmotionTone('distressed'); // Set high alert tone for UI
            } else {
                 // Try to parse JSON
                try {
                    const jsonResponse = JSON.parse(responseText);
                    const responderMessage: Message = {
                        id: Date.now(),
                        text: jsonResponse.response || "I'm having a little trouble formulating a response right now. Could you please try rephrasing?",
                        sender: 'responder',
                        timestamp: formatTime(new Date()),
                    };
                    setMessages(prev => [...prev, responderMessage]);
                    setEmotionTone(jsonResponse.emotion || 'default');
                } catch (e) {
                    // Fallback for non-JSON or malformed JSON responses
                     const responderMessage: Message = {
                        id: Date.now(),
                        text: responseText,
                        sender: 'responder',
                        timestamp: formatTime(new Date()),
                    };
                    setMessages(prev => [...prev, responderMessage]);
                    setEmotionTone('default');
                }
            }
        } catch (error) {
            console.error("Error sending message:", error);
            const errorMessage: Message = {
                id: Date.now(),
                text: "I'm sorry, I'm having trouble connecting right now. Please check your internet connection.",
                sender: 'responder',
                timestamp: formatTime(new Date())
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = async (e?: React.FormEvent, messageText = input) => {
        if (e) e.preventDefault();
        if (messageText.trim() === '') return;

        const userMessage: Message = {
            id: Date.now(),
            text: messageText,
            sender: 'user',
            timestamp: formatTime(new Date())
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');

        await sendMessageToAI(messageText);
    };
    
    const ExitConfirmationModal = () => (
        <div className="exit-confirmation-modal">
            <div className="modal-content">
                <h3>End Conversation?</h3>
                <p>Are you sure you want to end this conversation? Your chat history will not be saved.</p>
                <div className="modal-actions">
                    <button className="btn-secondary" onClick={() => setShowExitModal(false)}>Stay</button>
                    <button className="btn-primary" onClick={onExit}>End Chat</button>
                </div>
            </div>
        </div>
    );
    
    const isEmergencyMessage = (text: string) => text.startsWith('EMERGENCY:');

    return (
        <div className={`chat-screen emotion-${emotionTone}`}>
            <header className="chat-header">
                <div className="responder-info">
                    <h3>AI Responder</h3>
                    <p>Providing immediate support</p>
                </div>
                <div className="chat-actions">
                    <button className="chat-action-btn end" onClick={() => setShowExitModal(true)}>End</button>
                </div>
            </header>
            <div className="message-list" ref={messageListRef}>
                 {messages.map((msg) => (
                    <div key={msg.id} className={`message-bubble-container sender-${msg.sender}`}>
                        <div className={`message-bubble ${isEmergencyMessage(msg.text) ? 'emergency' : ''}`}>
                            <p>{msg.text}</p>
                            <span>{msg.timestamp}</span>
                        </div>
                    </div>
                ))}
                {isTyping && (
                     <div className="message-bubble-container sender-responder">
                        <div className="message-bubble typing-indicator">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}
            </div>
            <div className="chat-input-area">
                <form className="input-form" onSubmit={handleSend}>
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your message..."
                        aria-label="Chat message"
                    />
                    <button type="submit" disabled={!input.trim()}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                    </button>
                </form>
            </div>
            {showExitModal && <ExitConfirmationModal />}
        </div>
    );
}

// --- AUTHENTICATION & PORTAL COMPONENTS ---
type UserRole = 'user' | 'partner' | 'admin' | 'volunteer' | null;

/**
 * Custom hook for managing Firebase authentication state.
 */
function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState<UserRole>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                // Force refresh the token to get the latest custom claims.
                const idTokenResult = await currentUser.getIdTokenResult(true);
                const role = (idTokenResult.claims.role as UserRole) || 'user';
                setUserRole(role);
            } else {
                setUserRole(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    return { user, loading, userRole };
}

function AdminLogin({ onBack }: { onBack: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged will handle the redirect to the admin dashboard
        } catch (err: any) {
            setError('Login failed. Please check your credentials.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="community-portal-screen">
            <ResultsHeader onBack={onBack} />
            <div className="portal-content">
                <h2>Admin Portal Login</h2>
                <p>Please enter your administrator credentials.</p>
                <form className="community-form" onSubmit={handleLogin}>
                    {error && <div className="form-error-message">{error}</div>}
                    <div className="form-group">
                        <label htmlFor="email">Email Address</label>
                        <input type="email" id="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input type="password" id="password" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    <button type="submit" className="portal-submit-btn" disabled={loading}>
                        {loading ? 'Logging In...' : 'Log In'}
                    </button>
                </form>
            </div>
        </div>
    );
}

function VolunteerRegistrationForm({ onBack, onSubmitSuccess }: { onBack: () => void, onSubmitSuccess: () => void }) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        skills: [] as string[],
        availability: '',
        interest: '',
    });
    const [verificationDoc, setVerificationDoc] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            skills: checked ? [...prev.skills, value] : prev.skills.filter(s => s !== value),
        }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setVerificationDoc(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!verificationDoc) {
            setError('Please upload a verification document.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            // 1. Upload document to storage
            const storageRef = ref(storage, `verification_docs/volunteers/${formData.email}/${verificationDoc.name}`);
            const snapshot = await uploadBytes(storageRef, verificationDoc);
            const documentUrl = await getDownloadURL(snapshot.ref);

            // 2. Send data to backend
            const response = await fetch(`${API_BASE_URL}/volunteers/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, documentUrl }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Submission failed.');
            }
            onSubmitSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="community-portal-screen">
            <ResultsHeader onBack={onBack} />
            <div className="portal-content">
                <h2>Become a Volunteer</h2>
                <p>Join our team and help make a difference in the community.</p>
                <form className="community-form" onSubmit={handleSubmit}>
                    {error && <div className="form-error-message">{error}</div>}
                    <div className="form-group">
                        <label htmlFor="name">Full Name</label>
                        <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="email">Email Address</label>
                        <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="phone">Phone Number</label>
                        <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} required />
                    </div>
                    <hr />
                    <div className="form-group">
                        <label>Skills & Expertise</label>
                        <p className="form-hint">Select any skills you can contribute.</p>
                        <div className="checkbox-group">
                            {VOLUNTEER_SKILLS.map(skill => (
                                <label key={skill} className="checkbox-label">
                                    <input type="checkbox" name="skills" value={skill} onChange={handleCheckboxChange} />
                                    {skill}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="availability">Your Availability</label>
                        <input type="text" id="availability" name="availability" placeholder="e.g., Weekends, Weekday evenings" value={formData.availability} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="interest">Why do you want to volunteer?</label>
                        <textarea id="interest" name="interest" value={formData.interest} onChange={handleChange} rows={4} maxLength={500} required />
                    </div>
                    <hr />
                     <div className="form-group">
                        <label>Verification Document</label>
                         <p className="form-hint">Upload a government-issued ID for verification (e.g., Driver's License, Passport). This helps ensure the safety of our community.</p>
                        <div className="file-input-wrapper">
                             <input type="file" onChange={handleFileChange} required accept=".pdf,.png,.jpg,.jpeg"/>
                             <span>{verificationDoc ? verificationDoc.name : 'Click to upload your ID'}</span>
                        </div>
                    </div>
                    <button type="submit" className="portal-submit-btn" disabled={loading}>
                        {loading ? 'Submitting...' : 'Submit Application'}
                    </button>
                </form>
            </div>
        </div>
    );
}

function VolunteerDashboard({ user }: { user: User }) {
    const [applicationData, setApplicationData] = useState<Volunteer | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchApplication = async () => {
            if (!user.email) {
                setLoading(false);
                return;
            };
            try {
                const q = query(collection(db, 'volunteers'), where('email', '==', user.email), orderBy('submittedAt', 'desc'));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    const docData = querySnapshot.docs[0].data();
                    setApplicationData({ uid: querySnapshot.docs[0].id, ...docData } as Volunteer);
                }
            } catch (error) {
                console.error("Error fetching volunteer application:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchApplication();
    }, [user.email]);

    if (loading) {
        return (
            <div className="community-portal-screen">
                <div className="loading-spinner"><Spinner /></div>
            </div>
        );
    }
    
    return (
        <div className="community-portal-screen dashboard-page">
            <div className="portal-content dashboard">
                <div className="dashboard-header">
                    <h2>Volunteer Dashboard</h2>
                    <button className="portal-logout-btn" onClick={() => signOut(auth)}>Log Out</button>
                </div>

                {applicationData ? (
                    <>
                        <div className="dashboard-card status-card">
                            <h3>Application Status</h3>
                            <p><span className={`status-badge ${applicationData.status}`}>{applicationData.status}</span></p>
                            {applicationData.status === 'pending' && <p>Your application is under review. Our team will contact you soon!</p>}
                            {applicationData.status === 'verified' && <p>Welcome aboard! Thank you for joining the KavachNet team.</p>}
                            {applicationData.status === 'rejected' && <p>Thank you for your interest. We are unable to proceed with your application at this time.</p>}
                        </div>

                        <div className="dashboard-card details-card">
                            <h3>Your Application</h3>
                            <p><strong>Name:</strong> {applicationData.name}</p>
                            <p><strong>Email:</strong> {applicationData.email}</p>
                            <p><strong>Skills:</strong> {applicationData.skills.join(', ')}</p>
                        </div>
                    </>
                ) : (
                    <div className="dashboard-card status-card">
                        <h3>No Application Found</h3>
                        <p>We could not find a volunteer application associated with the email <br/><strong>{user.email}</strong>.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// --- COMMUNITY HUB ---
const MOCK_VOLUNTEER_ROLES = [
    { name: "Crisis Counselor", description: "Provide immediate, compassionate support via our chat service.", icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m12 5.25v-1.5m-6-6v-1.5m-6 7.5v-1.5m6-6h-1.5m6 0h-1.5m-6 0h-1.5m-6 0h1.5m6 0h1.5m-6 0h1.5M12 6.75v-1.5m0 7.5v-1.5" /></svg> },
    { name: "Resource Verifier", description: "Help verify and onboard new community partners to our network.", icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { name: "Community Outreach", description: "Spread awareness and build relationships with local organizations.", icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM21 21l-5.197-5.197" /></svg> }
];
const MOCK_UPDATES = [
    { date: "October 26, 2023", title: "New Partnership with MindWell Counseling to Expand Mental Health Services", content: "We are thrilled to announce..." },
    { date: "October 15, 2023", title: "Successful Launch of AI Responder Chat Feature", content: "Our new AI assistant has helped over 200 individuals in its first week." },
    { date: "September 30, 2023", title: "Volunteer Drive Adds 25 New Crisis Counselors to the Team", content: "A huge thank you to our community for the overwhelming support." }
];
const MOCK_BLOGS = [
    { title: "5 Grounding Techniques for Moments of Panic", excerpt: "When anxiety strikes, these simple techniques can help you find calm and stay present.", image: "💡", link: "https://www.crisistextline.org/resources/grounding/" },
    { title: "How to Support a Friend in a Mental Health Crisis", excerpt: "Knowing what to say and do can make a world of difference. Here are some key tips.", image: "🤝", link: "https://mhanational.org/helping-friend-or-loved-one" },
    { title: "Navigating Financial Distress: First Steps to Take", excerpt: "Feeling overwhelmed by finances is common. Here's a guide to finding the right help.", image: "💰", link: "https://www.consumerfinance.gov/coronavirus/managing-your-finances/help-for-financially-struggling-households/" }
];


// Component to display the list of saved emergency contacts
function SavedContactsList({ contacts, onDelete }: { contacts: EmergencyContact[], onDelete: (id: number) => void }) {
    if (contacts.length === 0) {
        return <p className="no-contacts-message">You haven't saved any emergency contacts yet.</p>;
    }

    return (
        <div className="saved-contacts-list">
            {contacts.map(contact => (
                <div key={contact.id} className="saved-contact-card">
                    <div className="contact-info">
                        <strong>{contact.name}</strong>
                        {contact.relationship && <small>{contact.relationship}</small>}
                        <p className="contact-phone">
                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.211-.998-.552-1.348l-5.452-5.452a2.25 2.25 0 00-3.182 0l-3.57 3.57a2.25 2.25 0 01-3.182 0L6.423 9.353a2.25 2.25 0 000-3.182l5.453-5.453C12.333 3.34 12.815 3.13 13.33 3.13h1.372c.621 0 1.125.504 1.125 1.125v2.25" /></svg>
                             <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                        </p>
                        {contact.email && <p className="contact-email">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                             <a href={`mailto:${contact.email}`}>{contact.email}</a>
                        </p>}
                    </div>
                    <button onClick={() => onDelete(contact.id)} className="delete-contact-btn" aria-label={`Delete contact ${contact.name}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.124-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.077-2.09.921-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                </div>
            ))}
        </div>
    );
}

// Component for the emergency contact form
function EmergencyContactForm({ onSave }: { onSave: (contact: Omit<EmergencyContact, 'id'>) => void }) {
    const [name, setName] = useState('');
    const [relationship, setRelationship] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !phone.trim()) {
            setError('Name and Phone Number are required.');
            return;
        }
        setError('');
        onSave({ name, relationship, phone, email });
        setName('');
        setRelationship('');
        setPhone('');
        setEmail('');
    };

    return (
        <form className="community-form emergency-contact-form" onSubmit={handleSubmit}>
            {error && <p className="form-error-message">{error}</p>}
            <div className="form-grid">
                <div className="form-group">
                    <label htmlFor="ec-name">Contact Name</label>
                    <input id="ec-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Jane Doe" required />
                </div>
                <div className="form-group">
                    <label htmlFor="ec-relationship">Relationship</label>
                    <input id="ec-relationship" type="text" value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="e.g., Partner, Parent" />
                </div>
                <div className="form-group">
                    <label htmlFor="ec-phone">Phone Number</label>
                    <input id="ec-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g., 1-800-555-1234" required />
                </div>
                <div className="form-group">
                    <label htmlFor="ec-email">Email (Optional)</label>
                    <input id="ec-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g., jane.doe@email.com" />
                </div>
            </div>
            <button type="submit" className="portal-submit-btn">Save Contact</button>
        </form>
    );
}

// Component for the new resource suggestion form
function SuggestResourceForm() {
    const [formData, setFormData] = useState({
        name: '',
        category: 'Mental Health Crisis' as Category,
        type: 'Hotline' as ResourceType,
        contact: '',
        openHours: '',
        description: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.contact || !formData.description) {
            setError('Please fill out all required fields: Name, Contact, and Description.');
            return;
        }
        setLoading(true);
        setError('');
        setSuccess('');
        try {
            const response = await fetch(`${API_BASE_URL}/resources/suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to submit resource.');
            }
            setSuccess('Thank you! Your suggestion has been submitted for review.');
            setFormData({ // Reset form
                name: '',
                category: 'Mental Health Crisis',
                type: 'Hotline',
                contact: '',
                openHours: '',
                description: ''
            });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form className="community-form" onSubmit={handleSubmit}>
            {error && <p className="form-error-message">{error}</p>}
            {success && <p className="form-success-message">{success}</p>}
            
            <div className="form-group">
                <label htmlFor="name">Resource Name</label>
                <input id="name" name="name" type="text" value={formData.name} onChange={handleChange} required placeholder="e.g., Downtown Community Food Bank" />
            </div>
            <div className="form-grid">
                <div className="form-group">
                    <label htmlFor="category">Category</label>
                    <select id="category" name="category" value={formData.category} onChange={handleChange}>
                        {CATEGORIES.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label htmlFor="type">Resource Type</label>
                    <select id="type" name="type" value={formData.type} onChange={handleChange}>
                        {RESOURCE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>
            </div>
            <div className="form-grid">
                <div className="form-group">
                    <label htmlFor="contact">Contact Info (Phone or Website)</label>
                    <input id="contact" name="contact" type="text" value={formData.contact} onChange={handleChange} required placeholder="e.g., 555-123-4567" />
                </div>
                <div className="form-group">
                    <label htmlFor="openHours">Open Hours</label>
                    <input id="openHours" name="openHours" type="text" value={formData.openHours} onChange={handleChange} placeholder="e.g., Mon-Fri 9am-5pm" />
                </div>
            </div>
            <div className="form-group">
                <label htmlFor="description">Description</label>
                <textarea id="description" name="description" value={formData.description} onChange={handleChange} rows={4} required placeholder="Briefly describe the services offered." />
            </div>
            <p className="form-hint">Our team will verify the information before adding it to our public network. Thank you for helping our community!</p>
            <button type="submit" className="portal-submit-btn" disabled={loading}>
                {loading ? 'Submitting...' : 'Submit for Review'}
            </button>
        </form>
    );
}

function CommunityHubPage({ onBack }: { onBack: () => void }) {
    const [pollChoice, setPollChoice] = useState('');
    const [pollSubmitted, setPollSubmitted] = useState(false);
    const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);

    useEffect(() => {
        try {
            const savedContacts = localStorage.getItem('kavachNetEmergencyContacts');
            if (savedContacts) {
                setEmergencyContacts(JSON.parse(savedContacts));
            }
        } catch (error) {
            console.error("Failed to parse emergency contacts from localStorage", error);
        }
    }, []);

    const handleSaveContact = (newContactData: Omit<EmergencyContact, 'id'>) => {
        const newContact: EmergencyContact = { ...newContactData, id: Date.now() };
        const updatedContacts = [...emergencyContacts, newContact];
        setEmergencyContacts(updatedContacts);
        localStorage.setItem('kavachNetEmergencyContacts', JSON.stringify(updatedContacts));
    };

    const handleDeleteContact = (id: number) => {
        const updatedContacts = emergencyContacts.filter(contact => contact.id !== id);
        setEmergencyContacts(updatedContacts);
        localStorage.setItem('kavachNetEmergencyContacts', JSON.stringify(updatedContacts));
    };

    return (
        <div className="community-hub-page">
            <ResultsHeader onBack={onBack} />
            <div className="hub-content">
                <header className="hub-header">
                    <h1>Community Hub</h1>
                    <p>The heart of KavachNet is our community. See how we're working together to provide a shield in times of crisis.</p>
                </header>

                <section className="hub-section">
                    <h2>Meet Our Volunteers</h2>
                    <p className="hub-section-intro">Our dedicated volunteers are the backbone of our service, providing compassionate support around the clock.</p>
                    <div className="volunteer-roles-grid">
                        {MOCK_VOLUNTEER_ROLES.map(role => (
                            <div key={role.name} className="role-card">
                                <div className="role-icon">{role.icon}</div>
                                <h3>{role.name}</h3>
                                <p>{role.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="hub-section">
                    <h2>Crisis Response Updates</h2>
                    <div className="updates-list">
                        {MOCK_UPDATES.map(update => (
                            <div key={update.title} className="update-item">
                                <span className="update-date">{update.date}</span>
                                <h3>{update.title}</h3>
                            </div>
                        ))}
                    </div>
                </section>
                
                <section className="hub-section">
                    <h2>Helpful Articles</h2>
                    <div className="blog-grid">
                        {MOCK_BLOGS.map(blog => (
                            <a key={blog.title} href={blog.link} className="blog-card" target="_blank" rel="noopener noreferrer">
                                <div className="blog-image">{blog.image}</div>
                                <div className="blog-content">
                                    <h3>{blog.title}</h3>
                                    <p>{blog.excerpt}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                </section>
                
                <section className="hub-section">
                    <h2>Suggest a New Resource</h2>
                    <p className="hub-section-intro">Know a helpful resource? Share it with the community. Every suggestion helps us build a stronger support network.</p>
                    <div className="suggest-resource-container">
                        <SuggestResourceForm />
                    </div>
                </section>

                <section className="hub-section">
                    <h2>Your Emergency Contacts</h2>
                    <p className="hub-section-intro">Save contact information for people you trust. This data is stored securely on your device and is never shared.</p>
                    <div className="emergency-contact-container">
                        <h3>Saved Contacts</h3>
                        <SavedContactsList contacts={emergencyContacts} onDelete={handleDeleteContact} />
                        <hr />
                        <h3>Add New Contact</h3>
                        <EmergencyContactForm onSave={handleSaveContact} />
                    </div>
                </section>

                 <section className="hub-section">
                    <h2>Community Poll</h2>
                     <div className="poll-container">
                        {pollSubmitted ? (
                            <div className="poll-thanks">Thank you for your feedback!</div>
                        ) : (
                            <>
                                <h3>What support topic should our next article cover?</h3>
                                <div className="poll-options">
                                    <label><input type="radio" name="poll" value="anxiety" onChange={e => setPollChoice(e.target.value)} /> Coping with Anxiety</label>
                                    <label><input type="radio" name="poll" value="grief" onChange={e => setPollChoice(e.target.value)} /> Navigating Grief</label>
                                    <label><input type="radio" name="poll" value="burnout" onChange={e => setPollChoice(e.target.value)} /> Recognizing Job Burnout</label>
                                </div>
                                <button className="poll-vote-btn" disabled={!pollChoice} onClick={() => setPollSubmitted(true)}>Vote</button>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

function AdminDashboard({ user }: { user: User }) {
    const [pendingPartners, setPendingPartners] = useState<CommunityPartner[]>([]);
    const [pendingVolunteers, setPendingVolunteers] = useState<Volunteer[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [dashboardData, setDashboardData] = useState({ totalResources: 0, pendingPartners: 0, pendingVolunteers: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [updating, setUpdating] = useState<Record<string, boolean>>({});

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const idToken = await user.getIdToken();
            const headers = { 'Authorization': `Bearer ${idToken}` };
            
            const [partnerQueueRes, volunteerQueueRes, dataRes, usersRes] = await Promise.all([
                fetch(`${API_BASE_URL}/admin/verification-queue`, { headers }),
                fetch(`${API_BASE_URL}/admin/volunteers/queue`, { headers }),
                fetch(`${API_BASE_URL}/admin/dashboard-data`, { headers }),
                fetch(`${API_BASE_URL}/admin/users`, { headers })
            ]);

            if (!partnerQueueRes.ok || !dataRes.ok || !volunteerQueueRes.ok || !usersRes.ok) {
                 throw new Error('Failed to fetch admin data.');
            }
            
            setPendingPartners(await partnerQueueRes.json());
            setPendingVolunteers(await volunteerQueueRes.json());
            setDashboardData(await dataRes.json());
            setAllUsers(await usersRes.json());

        } catch (err) {
            setError('Could not load dashboard. You may not have admin privileges.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [user]);

    const handleUpdateStatus = async (type: 'partner' | 'volunteer', id: string, status: 'verified' | 'rejected') => {
        setUpdating(prev => ({ ...prev, [id]: true }));
        try {
            const idToken = await user.getIdToken();
            const url = type === 'partner' 
                ? `${API_BASE_URL}/admin/update-partner-status`
                : `${API_BASE_URL}/admin/update-volunteer-status`;

            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ id, status })
            });
            await fetchData(); // Refresh all data
        } catch (err) {
            console.error("Failed to update status:", err);
            alert(`Error updating status. Please check console.`);
        } finally {
            setUpdating(prev => ({ ...prev, [id]: false }));
        }
    };
    
    const handleSetRole = async (uid: string, role: 'admin' | null) => {
        setUpdating(prev => ({ ...prev, [uid]: true }));
        try {
            const idToken = await user.getIdToken();
            await fetch(`${API_BASE_URL}/setRole`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ uid, role })
            });
            await fetchData(); // Refresh all data
        } catch (err) {
            console.error("Failed to set role:", err);
            alert(`Error setting role. Please check console.`);
        } finally {
            setUpdating(prev => ({ ...prev, [uid]: false }));
        }
    };

    if (loading) return <div className="admin-dashboard-screen"><Spinner /></div>;
    
    return (
        <div className="admin-dashboard-screen">
            <div className="admin-content">
                <div className="admin-header">
                    <h2>Admin Dashboard</h2>
                    <button className="portal-logout-btn" onClick={() => signOut(auth)}>Log Out</button>
                </div>

                {error && <div className="admin-error-message">{error}</div>}

                <div className="admin-analytics-grid">
                    <div className="admin-card"><h3>Total Verified Resources</h3><p>{dashboardData.totalResources}</p></div>
                     <div className="admin-card"><h3>Partner Applications</h3><p>{dashboardData.pendingPartners}</p></div>
                     <div className="admin-card"><h3>Volunteer Applications</h3><p>{dashboardData.pendingVolunteers}</p></div>
                </div>

                <div className="admin-section">
                    <div className="admin-section-header">
                        <h2>Partner Verification Queue</h2>
                        <button className="refresh-btn" onClick={fetchData}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0011.664 0l3.181-3.183m-4.991-2.695v-2.695A8.25 8.25 0 005.18 9.348m11.198 2.695l-3.181-3.182m0 0a8.25 8.25 0 00-11.664 0l-3.181 3.182" /></svg> Refresh</button>
                    </div>
                    <div className="admin-table-container">
                        <table className="admin-table">
                            <thead><tr><th>Partner Name</th><th>Type</th><th>Services</th><th>Document</th><th>Actions</th></tr></thead>
                            <tbody>
                                {pendingPartners.length > 0 ? pendingPartners.map(p => (
                                    <tr key={p.uid}>
                                        <td><strong className="partner-name">{p.name}</strong><br/>{p.contact}</td>
                                        <td className="capitalize">{p.type}</td><td>{p.services.join(', ')}</td>
                                        <td><a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="partner-doc-link">View Doc</a></td>
                                        <td className="actions-cell">
                                            <button className="action-btn verify" onClick={() => handleUpdateStatus('partner', p.uid, 'verified')} disabled={updating[p.uid]}>Verify</button>
                                            <button className="action-btn reject" onClick={() => handleUpdateStatus('partner', p.uid, 'rejected')} disabled={updating[p.uid]}>Reject</button>
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={5} className="table-empty-state">The partner verification queue is empty.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="admin-section">
                    <div className="admin-section-header"><h2>Volunteer Verification Queue</h2></div>
                     <div className="admin-table-container">
                        <table className="admin-table">
                            <thead><tr><th>Applicant Name</th><th>Contact</th><th>Skills</th><th>Document</th><th>Actions</th></tr></thead>
                            <tbody>
                                {pendingVolunteers.length > 0 ? pendingVolunteers.map(v => (
                                    <tr key={v.uid}>
                                        <td>{v.name}</td><td>{v.email}<br/>{v.phone}</td><td>{v.skills.join(', ')}</td>
                                        <td><a href={v.documentUrl} target="_blank" rel="noopener noreferrer" className="partner-doc-link">View ID</a></td>
                                        <td className="actions-cell">
                                            <button className="action-btn verify" onClick={() => handleUpdateStatus('volunteer', v.uid, 'verified')} disabled={updating[v.uid]}>Verify</button>
                                            <button className="action-btn reject" onClick={() => handleUpdateStatus('volunteer', v.uid, 'rejected')} disabled={updating[v.uid]}>Reject</button>
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={5} className="table-empty-state">The volunteer verification queue is empty.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="admin-section">
                    <div className="admin-section-header"><h2>User Management</h2></div>
                    <div className="admin-table-container">
                        <table className="admin-table">
                            <thead><tr><th>User Email</th><th>Role</th><th>Actions</th></tr></thead>
                            <tbody>
                                {allUsers.length > 0 ? allUsers.map(u => (
                                    <tr key={u.uid}>
                                        <td>{u.email}</td>
                                        <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                                        <td className="actions-cell">
                                            {u.role !== 'admin' ? (
                                                <button className="action-btn promote" onClick={() => handleSetRole(u.uid, 'admin')} disabled={updating[u.uid]}>Promote to Admin</button>
                                            ) : (
                                                u.uid !== user.uid ? ( // Prevent self-demotion
                                                    <button className="action-btn revoke" onClick={() => handleSetRole(u.uid, null)} disabled={updating[u.uid]}>Revoke Admin</button>
                                                ) : <span className="current-user-text">This is you</span>
                                            )}
                                        </td>
                                    </tr>
                                )) : <tr><td colSpan={3} className="table-empty-state">No users found.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- DEMO SESSION COMPONENTS ---

// Mock Data for Demos
const CURATED_SCENARIOS = [
    {
        title: "Mental Health Support in Downtown LA",
        description: "A map showing verified counselors and 24/7 hotlines in the downtown Los Angeles area.",
        center: { lat: 34.0522, lon: -118.2437 },
        resources: [
            { id: 'demo-mh-1', name: 'LA MindWell Counseling', category: 'Mental Health Crisis', lat: 34.055, lon: -118.250, contact: '1-800-273-8255', type: 'Counselor', openHours: 'Mon-Fri 9am-5pm', rating: 4.8, description: 'Professional counseling for anxiety and depression.', verified: true },
            { id: 'demo-mh-2', name: 'Peaceful Minds Clinic (LA)', category: 'Mental Health Crisis', lat: 34.048, lon: -118.241, contact: '1-800-950-6264', type: 'Counselor', openHours: '24/7 Hotline', rating: 4.9, description: '24/7 crisis hotline and walk-in clinic.', verified: true },
            { id: 'demo-mh-3', name: 'Downtown LA Support Line', category: 'Mental Health Crisis', lat: 34.058, lon: -118.235, contact: '211', type: 'Hotline', openHours: '24/7', rating: 4.4, description: 'A general helpline for various social services.', verified: true },
            { id: 'demo-mh-4', name: 'Hope & Healing Center', category: 'Mental Health Crisis', lat: 34.062, lon: -118.255, contact: '1-888-448-4673', type: 'Counselor', openHours: 'Mon-Sat 10am-6pm', rating: 4.7, description: 'Support groups and individual therapy.', verified: true },
        ]
    },
    {
        title: "Post-Earthquake Emergency Shelters",
        description: "Hypothetical emergency shelters activated in San Francisco following a major earthquake.",
        center: { lat: 37.7749, lon: -122.4194 },
        resources: [
            { id: 'demo-nd-1', name: 'Civic Center Plaza Shelter', category: 'Natural Disaster', lat: 37.779, lon: -122.419, contact: 'N/A', type: 'Shelter', openHours: '24/7', rating: 0, description: 'Capacity: 500. Medical staff on site.', verified: true },
            { id: 'demo-nd-2', name: 'Golden Gate Park Relief Center', category: 'Natural Disaster', lat: 37.769, lon: -122.486, contact: 'N/A', type: 'Relief Center', openHours: '24/7', rating: 0, description: 'Food, water, and temporary shelter available.', verified: true },
            { id: 'demo-nd-3', name: 'Moscone Center West', category: 'Natural Disaster', lat: 37.784, lon: -122.403, contact: 'N/A', type: 'Shelter', openHours: '24/7', rating: 0, description: 'Large-scale shelter. Pets welcome.', verified: true },
            { id: 'demo-nd-4', name: 'Bayview Community Shelter', category: 'Natural Disaster', lat: 37.729, lon: -122.39, contact: 'N/A', type: 'Shelter', openHours: '24/7', rating: 0, description: 'Shelter for families with children.', verified: true },
        ]
    },
];

const MENTAL_HEALTH_HELPLINES = [
    { name: 'National Suicide Prevention Lifeline', contact: '988', description: '24/7, free and confidential support.', icon: '📞' },
    { name: 'Crisis Text Line', contact: 'Text HOME to 741741', description: 'Free, 24/7 crisis support via text.', icon: '💬' },
    { name: 'The Trevor Project', contact: '1-866-488-7386', description: 'Support for LGBTQ young people.', icon: '🏳️‍🌈' }
];

const MENTAL_HEALTH_ARTICLES = [
    { title: "5 Grounding Techniques for Moments of Panic", excerpt: "When anxiety strikes, these simple techniques can help you find calm and stay present.", image: "💡" },
    { title: "How to Support a Friend in a Mental Health Crisis", excerpt: "Knowing what to say and do can make a world of difference. Here are some key tips.", image: "🤝" }
];

const EARTHQUAKE_HELPLINES = [
    { name: 'FEMA Disaster Assistance', contact: '1-800-621-3362', description: 'Apply for federal disaster aid.', icon: '🇺🇸' },
    { name: 'American Red Cross', contact: '1-800-733-2767', description: 'Find shelters and emergency aid.', icon: '⛑️' },
    { name: 'City Emergency Services', contact: '311', description: 'For non-emergency information.', icon: '🏢' },
];

const EARTHQUAKE_ALERTS = [
    { time: '1 min ago', text: 'New shelter opened at Moscone Center West. Capacity: 2000. Pets welcome.' },
    { time: '5 mins ago', text: 'Water distribution point established at Civic Center Plaza. Limit 1 gallon per person.' },
    { time: '12 mins ago', text: 'ALERT: Aftershock warning for the next 2 hours. Drop, Cover, and Hold On.' }
];


const HYPOTHETICAL_EVENT_CENTER = { lat: 33.6846, lon: -117.8265 }; // Irvine, CA
const HYPOTHETICAL_INITIAL_RESOURCES: SupportCenter[] = [
    { id: 'hypo-1', name: 'University Park Staging Area', category: 'Natural Disaster', lat: 33.671, lon: -117.834, contact: 'N/A', type: 'Relief Center', openHours: 'Live', rating: 0, description: 'Initial staging area for first responders.', verified: true },
    { id: 'hypo-2', name: 'City Hall Command Post', category: 'Natural Disaster', lat: 33.684, lon: -117.825, contact: 'N/A', type: 'Relief Center', openHours: 'Live', rating: 0, description: 'Central command for the wildfire event.', verified: true },
];

function DemoSessionPage({ onBack, onSelectScenario }: { onBack: () => void, onSelectScenario: (scenario: 'mental-health' | 'earthquake') => void }) {
    const [view, setView] = useState<'selection' | 'hypothetical'>('selection');
    const [liveResources, setLiveResources] = useState<SupportCenterWithDistance[]>([]);
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const simulationInterval = useRef<number | null>(null);

    // Logic for Hypothetical Simulation
    useEffect(() => {
        if (view === 'hypothetical') {
            const initialResourcesWithDistance = HYPOTHETICAL_INITIAL_RESOURCES.map(r => ({
                ...r,
                distance: getDistance(HYPOTHETICAL_EVENT_CENTER.lat, HYPOTHETICAL_EVENT_CENTER.lon, r.lat, r.lon)
            }));
            setLiveResources(initialResourcesWithDistance);

            simulationInterval.current = window.setInterval(() => {
                setLiveResources(prevResources => {
                    let updated = [...prevResources];
                    const rand = Math.random();

                    if (rand < 0.5 && updated.length < 6) { // Add a new resource
                        const newId = `hypo-${Date.now()}`;
                        const newResource: SupportCenterWithDistance = {
                            id: newId,
                            name: `Pop-up Shelter #${updated.length + 1}`,
                            category: 'Natural Disaster',
                            lat: HYPOTHETICAL_EVENT_CENTER.lat + (Math.random() - 0.5) * 0.1,
                            lon: HYPOTHETICAL_EVENT_CENTER.lon + (Math.random() - 0.5) * 0.1,
                            contact: 'N/A',
                            type: 'Shelter',
                            openHours: 'Live',
                            rating: 0,
                            description: 'Newly opened shelter. Supplies are en route.',
                            verified: true,
                            distance: 0,
                        };
                        newResource.distance = getDistance(HYPOTHETICAL_EVENT_CENTER.lat, HYPOTHETICAL_EVENT_CENTER.lon, newResource.lat, newResource.lon);
                        updated.push(newResource);
                    } else if (rand >= 0.5 && updated.length > 2) { // Update an existing resource
                        const randomIndex = Math.floor(Math.random() * updated.length);
                        const resourceToUpdate = { ...updated[randomIndex] };
                        resourceToUpdate.description = `UPDATE: Now at ${Math.round(Math.random() * 80) + 20}% capacity.`;
                        updated[randomIndex] = resourceToUpdate;
                    }
                    return updated;
                });
            }, 3000); // Update every 3 seconds
        }

        return () => { // Cleanup
            if (simulationInterval.current) {
                clearInterval(simulationInterval.current);
            }
        };
    }, [view]);

    const renderContent = () => {
        if (view === 'hypothetical') {
            return (
                <div className="demo-view-container">
                    <div className="demo-view-header">
                        <div>
                            <h2>Live Hypothetical Event: Wildfire</h2>
                            <p>This map simulates a real-time crisis, with resources updating automatically.</p>
                        </div>
                        <div className="live-indicator">
                            <div className="live-dot"></div>
                            <span>LIVE SIMULATION</span>
                        </div>
                    </div>
                     <div className="nearby-content">
                        <MapView 
                            centers={liveResources} 
                            userLocation={HYPOTHETICAL_EVENT_CENTER}
                            onMarkerClick={setHighlightedId}
                            enableClustering
                        />
                        <ListView 
                            centers={liveResources} 
                            onSelect={() => {}}
                            highlightedId={highlightedId}
                        />
                    </div>
                </div>
            );
        }

        // Default to selection view
        return (
            <>
                <header className="hub-header">
                    <h1>Demo Session</h1>
                    <p>Explore how KavachNet works with curated examples and a live hypothetical crisis map.</p>
                </header>
                <div className="demo-selection-container">
                    <div className="hub-section">
                        <h2>Curated Scenarios</h2>
                        <p className="hub-section-intro">Explore pre-built, feature-rich pages for specific crisis situations to see what kind of help is available.</p>
                        <div className="curated-scenario-list">
                            <button className="curated-scenario-card" onClick={() => onSelectScenario('mental-health')}>
                                <h3>{CURATED_SCENARIOS[0].title}</h3>
                                <p>{CURATED_SCENARIOS[0].description}</p>
                            </button>
                             <button className="curated-scenario-card" onClick={() => onSelectScenario('earthquake')}>
                                <h3>{CURATED_SCENARIOS[1].title}</h3>
                                <p>{CURATED_SCENARIOS[1].description}</p>
                            </button>
                        </div>
                    </div>
                    <div className="hub-section">
                        <h2>Live Hypothetical Event</h2>
                        <p className="hub-section-intro">Watch a simulated wildfire event unfold in real-time. New shelters will appear and update automatically on the map.</p>
                        <button className="demo-choice-card" onClick={() => setView('hypothetical')}>
                            <div className="demo-card-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                            </div>
                            <h3>Launch Wildfire Simulation</h3>
                        </button>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="demo-session-page">
            <ResultsHeader onBack={view === 'selection' ? onBack : () => setView('selection')} />
            <div className="hub-content">
                {renderContent()}
            </div>
        </div>
    );
}

function MentalHealthDemoPage({ onBack }: { onBack: () => void }) {
    const scenario = CURATED_SCENARIOS[0];
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const resourcesWithDistance = useMemo(() => {
        return scenario.resources.map(r => ({
            ...r,
            distance: getDistance(scenario.center.lat, scenario.center.lon, r.lat, r.lon)
        }));
    }, [scenario]);

    return (
        <div className="mental-health-demo-page">
            <ResultsHeader onBack={onBack} />
            <div className="demo-page-content">
                <header className="demo-page-header">
                    <div>
                        <h1>{scenario.title}</h1>
                        <p>{scenario.description}</p>
                    </div>
                    <div className="simulation-badge">DEMO</div>
                </header>

                <section className="demo-section">
                    <h2>Immediate Helplines</h2>
                    <div className="helplines-grid-demo">
                        {MENTAL_HEALTH_HELPLINES.map(line => (
                             <a href={`tel:${line.contact}`} key={line.name} className="helpline-card-demo">
                                <div className="helpline-icon-demo">{line.icon}</div>
                                <div>
                                    <strong>{line.name}</strong>
                                    <span>{line.contact}</span>
                                    <p>{line.description}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                </section>
                
                <section className="demo-section">
                    <h2>Clustered Map of Resources</h2>
                     <div className="nearby-content">
                        <MapView 
                            centers={resourcesWithDistance} 
                            userLocation={scenario.center}
                            onMarkerClick={setHighlightedId}
                            enableClustering
                        />
                        <ListView 
                            centers={resourcesWithDistance} 
                            onSelect={() => {}}
                            highlightedId={highlightedId}
                        />
                    </div>
                </section>
                
                 <section className="demo-section">
                    <h2>Helpful Articles</h2>
                    <div className="articles-grid-demo">
                        {MENTAL_HEALTH_ARTICLES.map(article => (
                            <a key={article.title} href="#" className="article-card-demo">
                                <div className="article-image-demo">{article.image}</div>
                                <div className="article-content-demo">
                                    <h3>{article.title}</h3>
                                    <p>{article.excerpt}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

function EarthquakeDemoPage({ onBack }: { onBack: () => void }) {
    const scenario = CURATED_SCENARIOS[1];
     const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const resourcesWithDistance = useMemo(() => {
        return scenario.resources.map(r => ({
            ...r,
            distance: getDistance(scenario.center.lat, scenario.center.lon, r.lat, r.lon)
        }));
    }, [scenario]);

    return (
        <div className="earthquake-demo-page">
            <ResultsHeader onBack={onBack} />
            <div className="demo-page-content">
                 <header className="demo-page-header">
                    <div>
                        <h1>{scenario.title}</h1>
                        <p>{scenario.description}</p>
                    </div>
                    <div className="simulation-badge">DEMO</div>
                </header>

                <section className="demo-section alerts-section">
                    <h2>Live Alerts</h2>
                    <div className="alerts-list">
                        {EARTHQUAKE_ALERTS.map(alert => (
                            <div key={alert.text} className="alert-item">
                                <span className="alert-time">{alert.time}</span>
                                <p>{alert.text}</p>
                            </div>
                        ))}
                    </div>
                </section>
                
                <section className="demo-section">
                    <h2>Essential Actions</h2>
                    <div className="essential-actions-grid">
                        <button className="action-card"><div className="action-icon">🏠</div> Find Shelter</button>
                        <button className="action-card"><div className="action-icon">💧</div> Find Food/Water</button>
                        <button className="action-card"><div className="action-icon">⚕️</div> Get Medical Aid</button>
                        <button className="action-card"><div className="action-icon">✅</div> Report Safe</button>
                    </div>
                </section>

                <section className="demo-section">
                    <h2>Map of Shelters & Relief Centers</h2>
                     <div className="nearby-content">
                        <MapView 
                            centers={resourcesWithDistance} 
                            userLocation={scenario.center}
                            onMarkerClick={setHighlightedId}
                            enableClustering
                        />
                        <ListView 
                            centers={resourcesWithDistance} 
                            onSelect={() => {}}
                            highlightedId={highlightedId}
                        />
                    </div>
                </section>
            </div>
        </div>
    );
}


// --- MAIN APP COMPONENT ---

type AppState =
    | { view: 'splash' }
    | { view: 'onboarding' }
    | { view: 'home' }
    | { view: 'crisisDetail', category: Category }
    | { view: 'resourceDetail', resource: SupportCenter }
    | { view: 'chat', initialMessage?: string }
    | { view: 'communityHub' }
    | { view: 'volunteerRegistration' }
    | { view: 'adminLogin' }
    | { view: 'demoSession' }
    | { view: 'mentalHealthDemo' }
    | { view: 'earthquakeDemo' };


function App() {
    const [appState, setAppState] = useState<AppState>({ view: 'splash' });
    const [notification, setNotification] = useState<string | null>(null);
    const { resources, loading: resourcesLoading, error: resourcesError } = useSupportResources();
    const { user, loading: authLoading, userRole } = useAuth();
    const isOnline = useNetworkStatus();
    
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    // App initialization logic
    useEffect(() => {
        const hasCompletedOnboarding = localStorage.getItem('onboardingComplete');
        if (appState.view === 'splash' && !hasCompletedOnboarding) {
            setTimeout(() => setAppState({ view: 'onboarding' }), 2000);
        } else if (appState.view === 'splash') {
            setTimeout(() => setAppState({ view: 'home' }), 2000);
        }
    }, [appState.view]);
    
    // --- AUTH & ROLE-BASED ROUTING ---

    if (authLoading) {
        return <div className="loading-location-screen"><Spinner/></div>;
    }

    // If a user is logged in, check their role and show the appropriate dashboard.
    // This provides a completely separate experience from the public-facing app.
    if (user && userRole) {
        switch (userRole) {
            case 'admin':
                return <AdminDashboard user={user} />;
            case 'volunteer':
                return <VolunteerDashboard user={user} />;
            // 'user' and 'partner' roles fall through to the public application.
        }
    }

    // --- PUBLIC-FACING APP & GUEST ROUTING ---
    
    if (!isOnline && appState.view !== 'splash') {
        return <OfflineScreen cachedResources={MOCK_SUPPORT_CENTERS} />;
    }
    
    const handleOnboardingFinish = () => {
        localStorage.setItem('onboardingComplete', 'true');
        setAppState({ view: 'home' });
    };

    const renderContent = () => {
        switch (appState.view) {
            case 'splash':
                return <SplashScreen onFinish={() => {
                     const hasCompletedOnboarding = localStorage.getItem('onboardingComplete');
                     setAppState(hasCompletedOnboarding ? { view: 'home' } : { view: 'onboarding' });
                }} />;
            case 'onboarding':
                return <OnboardingScreen onFinish={handleOnboardingFinish} />;
            case 'home':
                return (
                    <>
                        <HomePage 
                            onSelectCategory={(category) => setAppState({ view: 'crisisDetail', category })}
                            onStartChat={() => setAppState({ view: 'chat' })}
                            onStartDemo={() => setAppState({ view: 'demoSession' })}
                        />
                        <AppFooter setAppState={setAppState} />
                    </>
                );
            case 'crisisDetail':
                return (
                    <CrisisDetailPage
                        category={appState.category}
                        allResources={resources}
                        onBack={() => setAppState({ view: 'home' })}
                        onSelectResource={(resource) => setAppState({ view: 'resourceDetail', resource })}
                        onStartChat={(message) => setAppState({ view: 'chat', initialMessage: message })}
                    />
                );
            case 'resourceDetail':
                 return (
                    <ResourceDetailPage
                        resource={appState.resource}
                        onBack={() => setAppState({ view: 'crisisDetail', category: appState.resource.category })}
                        onStartChat={(resourceName) => setAppState({ view: 'chat', initialMessage: `I'd like to talk about ${resourceName}.` })}
                    />
                );
            case 'chat':
                return <ChatScreen onExit={() => setAppState({ view: 'home' })} initialMessage={appState.initialMessage} />;
            case 'communityHub':
                return <CommunityHubPage onBack={() => setAppState({ view: 'home' })} />;
            case 'adminLogin':
                return <AdminLogin onBack={() => setAppState({ view: 'home' })} />;
            case 'volunteerRegistration':
                return <VolunteerRegistrationForm 
                    onBack={() => setAppState({ view: 'home' })} 
                    onSubmitSuccess={() => {
                        setNotification('Thank you for your application! Our team will review it and get in touch.');
                        setAppState({ view: 'home' });
                    }}
                />;
            case 'demoSession':
                return <DemoSessionPage 
                    onBack={() => setAppState({ view: 'home' })} 
                    onSelectScenario={(scenario) => {
                        if (scenario === 'mental-health') setAppState({ view: 'mentalHealthDemo' });
                        if (scenario === 'earthquake') setAppState({ view: 'earthquakeDemo' });
                    }}
                />;
            case 'mentalHealthDemo':
                return <MentalHealthDemoPage onBack={() => setAppState({ view: 'demoSession' })} />;
            case 'earthquakeDemo':
                return <EarthquakeDemoPage onBack={() => setAppState({ view: 'demoSession' })} />;
            default:
                return <div>Unhandled App State</div>;
        }
    };
    
    const NotificationBanner = () => {
        if (!notification) return null;
        return <div className="notification-banner">{notification}</div>;
    }

    return (
        <div id="app-wrapper">
            {!isOnline && <OfflineIndicatorBanner />}
            <NotificationBanner />
            {renderContent()}
        </div>
    );
}

function AppFooter({ setAppState }: { setAppState: (state: AppState) => void }) {
    return (
        <footer className="app-footer">
            <button className="footer-link" onClick={() => setAppState({ view: 'communityHub' })}>
                Community Hub
            </button>
            <button className="footer-link" onClick={() => setAppState({ view: 'volunteerRegistration' })}>
                Become a Volunteer
            </button>
            <button className="footer-link" onClick={() => setAppState({ view: 'adminLogin' })}>
                Admin Portal
            </button>
        </footer>
    );
}


const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}