export interface ChatMessage {
  sender: 'them' | 'me';
  text: string;
  time?: string;
}

export interface ContentScenario {
  id: string;
  chat: {
    contactName: string;
    appStyle: 'imessage' | 'instagram' | 'whatsapp';
    messages: ChatMessage[];
  };
  personAvatar?: string;
  personDisplayName?: string;
  personRelationshipStatus?: string;
  results: {
    personName: string;
    personGender: 'male' | 'female';
    overallScore: number;
    warmthScore: number;
    communicationScore: number;
    dramaScore: number;
    distanceScore: number;
    passionScore: number;
    profileType: string;
    profileSubtitle: string;
    profileDescription: string;
    personSoulType: string;
    userSoulType: string;
    personDescription?: string;
    personTraits?: string[];
    personEnergyType?: string;
    userDescription?: string;
    userTraits?: string[];
    userEnergyType?: string;
    categories: {
      intentions: { description: string };
      chemistry: { description: string };
      effort: { description: string };
      redFlagsGreenFlags: { description: string };
      trajectory: { description: string };
    };
    messageInsights: Array<{
      message: string;
      title: string;
      tag: 'RED FLAG' | 'GREEN FLAG' | 'DECODED';
      description: string;
      solution: string;
    }>;
    dynamic: {
      name: string;
      subtitle: string;
      whyThisHappens: string;
      patternBreak: string;
      powerBalance: number;
    };
  };
}
