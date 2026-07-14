import React, { useState, useEffect } from "react";
import { Plus, Users, Sparkles, Trash2, Search, Mail, Phone, MapPin, Briefcase, AlertCircle } from "lucide-react";
import { Contact } from "../types";

export default function ContactsView() {
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = localStorage.getItem("life_os_contacts");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        firstName: "Sarah",
        middleName: "",
        lastName: "Jenkins",
        jobTitle: "Senior Cloud Architect",
        email: "sarah.jenkins@google.com",
        phone: "+1 (555) 349-2041",
        address: "Mountain View, CA",
        dobString: "1994-08-12",
        anniversaryString: "",
        folder: "Work",
        attachedFilesJson: "[]"
      },
      {
        id: 2,
        firstName: "Michael",
        middleName: "A.",
        lastName: "Patterson",
        jobTitle: "Creative Director",
        email: "mike.p@designstudio.io",
        phone: "+1 (555) 782-9011",
        address: "Brooklyn, NY",
        dobString: "1989-11-23",
        anniversaryString: "",
        folder: "Personal",
        attachedFilesJson: "[]"
      }
    ];
  });

  const [search, setSearch] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [folder, setFolder] = useState("Work");

  useEffect(() => {
    localStorage.setItem("life_os_contacts", JSON.stringify(contacts));
  }, [contacts]);

  const addContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    const newContact: Contact = {
      id: Date.now(),
      firstName: firstName.trim(),
      middleName: "",
      lastName: lastName.trim(),
      jobTitle: jobTitle.trim() || "Freelancer",
      email: email.trim(),
      phone: phone.trim(),
      address: "",
      dobString: "",
      anniversaryString: "",
      folder: folder,
      attachedFilesJson: "[]"
    };

    setContacts([...contacts, newContact]);
    setFirstName("");
    setLastName("");
    setJobTitle("");
    setEmail("");
    setPhone("");
  };

  const deleteContact = (id: number) => {
    setContacts(contacts.filter(c => c.id !== id));
  };

  const filteredContacts = contacts.filter(c => 
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()) || 
    c.jobTitle.toLowerCase().includes(search.toLowerCase()) || 
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Creation Pane */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 select-none">
          <Sparkles className="h-4 w-4 text-blue-500" />
          Enlist Contact
        </h2>
        <form onSubmit={addContact} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">First Name *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Sarah"
                className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Jenkins"
                className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Job Title</label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g., Senior Systems Designer"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah.j@google.com"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Directory Folder</label>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
            >
              <option value="Work">💼 Work Directory</option>
              <option value="Personal">🏡 Personal Contacts</option>
              <option value="Partners">🔥 External Partners</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/10"
          >
            <Plus className="h-4 w-4" /> Save Contact
          </button>
        </form>
      </div>

      {/* Directory database view */}
      <div className="lg:col-span-2 bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col h-[520px]">
        <div className="space-y-3 select-none">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 border-b border-gray-900 pb-3">
            <Users className="h-4 w-4 text-blue-500" />
            Address Book Directory ({filteredContacts.length})
          </h2>
          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, job, or email..."
              className="w-full bg-gray-900 border border-gray-850 text-xs pl-9 pr-4 h-11 rounded-xl outline-none text-white focus:border-blue-500/50 transition-all"
            />
          </div>
        </div>

        {/* Contacts card list */}
        <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
          {filteredContacts.map((contact) => (
            <div
              key={contact.id}
              className="p-4 bg-gray-900/35 border border-gray-850 hover:border-gray-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all"
            >
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0 select-none">
                  {contact.firstName[0]}{contact.lastName[0]}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-white">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className="text-[8px] font-mono font-bold bg-blue-500/10 border border-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded uppercase select-none">
                      {contact.folder}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-gray-400 leading-relaxed font-mono">
                    <span className="flex items-center gap-1.5 truncate">
                      <Briefcase className="h-3.5 w-3.5 text-gray-500 shrink-0" /> {contact.jobTitle}
                    </span>
                    {contact.email && (
                      <span className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3.5 w-3.5 text-gray-500 shrink-0" /> {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="flex items-center gap-1.5 truncate">
                        <Phone className="h-3.5 w-3.5 text-gray-500 shrink-0" /> {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end select-none">
                <button
                  onClick={() => deleteContact(contact.id)}
                  className="text-gray-500 hover:text-red-400 p-2 rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900/30 transition-all cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {filteredContacts.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center p-12 space-y-2 h-full">
              <AlertCircle className="h-8 w-8 text-gray-600 animate-bounce" />
              <p className="text-xs text-gray-500">No contact accounts found in Address Book.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
