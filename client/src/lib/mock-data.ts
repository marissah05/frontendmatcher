export interface PNM {
  id: string;
  name: string;
  idNumber: string;
  status: 'unmatched' | 'matched';
  matchedWith?: string; // activeId 1
  secondMatch?: string; // activeId 2
}

export interface Active {
  id: string;
  name: string;
}

export const MOCK_PNMS: PNM[] = [
  { id: 'p1', name: 'Isabella Worthington', idNumber: '1001', status: 'unmatched' },
  { id: 'p2', name: 'Sophia Sterling', idNumber: '1002', status: 'unmatched' },
  { id: 'p3', name: 'Olivia Kensington', idNumber: '1003', status: 'unmatched' },
  { id: 'p4', name: 'Emma Chamberlain', idNumber: '1004', status: 'unmatched' },
];

export const MOCK_ACTIVES: Active[] = [
  { id: 'a1', name: 'Sarah Jenkins' },
  { id: 'a2', name: 'Jessica Reynolds' },
  { id: 'a3', name: 'Amanda Chen' },
  { id: 'a4', name: 'Madison Pierce' },
];
