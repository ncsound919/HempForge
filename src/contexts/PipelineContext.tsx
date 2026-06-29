import React, {
  createContext,
  useContext,
  useMemo,
  useReducer,
  useRef,
  ReactNode,
} from 'react';
import { DocumentEntry } from '../components/DocumentLibrary';

type PipelineStep = 1 | 2 | 3 | 4;

type DraftTemplateType =
  | 'Academic Journal Paper'
  | 'Regulatory Brief'
  | 'Regulatory Compliance Brief'
  | 'Executive Summary'
  | 'Technical Report'
  | 'Clinical Trial Whitepaper';

interface DraftedPaperData {
  title?: string;
  abstract?: string;
  markdown?: string;
  compounds?: string[];
  dosage?: string;
  outcomes?: string;
  simulated?: boolean;
  [key: string]: unknown;
}

interface PipelineState {
  allPapers: DocumentEntry[];
  selectedPaperEntity: DocumentEntry | null;
  coaRawInput: string;
  isParsingCoa: boolean;
  parsingMessage: string;
  pipelineStep: PipelineStep;
  pipelineStrain: string;
  pipelineTHCa: number;
  pipelineD9THC: number;
  pipelineMoisture: number;
  pipelineTemp: number;
  pipelineDuration: number;
  pipelineRatios: string;
  draftTemplateType: DraftTemplateType;
  isDraftingPaper: boolean;
  draftedPaperData: DraftedPaperData | null;
  isPaperPublished: boolean;
}

type PipelineAction =
  | { type: 'SET_ALL_PAPERS'; payload: DocumentEntry[] }
  | { type: 'ADD_PAPER'; payload: DocumentEntry }
  | { type: 'SET_SELECTED_PAPER'; payload: DocumentEntry | null }
  | { type: 'SET_COA_RAW_INPUT'; payload: string }
  | { type: 'SET_IS_PARSING_COA'; payload: boolean }
  | { type: 'SET_PARSING_MESSAGE'; payload: string }
  | { type: 'SET_PIPELINE_STEP'; payload: PipelineStep }
  | { type: 'PATCH_PIPELINE_FIELDS'; payload: Partial<Pick<
      PipelineState,
      | 'pipelineStrain'
      | 'pipelineTHCa'
      | 'pipelineD9THC'
      | 'pipelineMoisture'
      | 'pipelineTemp'
      | 'pipelineDuration'
      | 'pipelineRatios'
      | 'draftTemplateType'
    >> }
  | { type: 'SET_IS_DRAFTING_PAPER'; payload: boolean }
  | { type: 'SET_DRAFTED_PAPER_DATA'; payload: DraftedPaperData | null }
  | { type: 'SET_IS_PAPER_PUBLISHED'; payload: boolean }
  | { type: 'LOAD_PARSED_COA'; payload: Partial<Pick<
      PipelineState,
      | 'pipelineStrain'
      | 'pipelineTHCa'
      | 'pipelineD9THC'
      | 'pipelineMoisture'
      | 'coaRawInput'
    >> }
  | { type: 'RESET_PIPELINE' };

const DEFAULT_COA_INPUT = `HempForge Analytics Lab - Certificate of Analysis
BATCH ID: HF-EX-99801
STRAIN CULTIVAR: Sour Diesel Acidic Cut
MOISTURE CONTENT: 11.45%
POTENCY ANALYSIS (HPLC-UV):
  THCa: 18.65 wt%
  Delta-9 THC: 0.12 wt%
  CBDa: 0.45 wt%
  CBC: 0.22 wt%
STATUS: PRE-EXTRACTION RAW FLOWER`;

const initialPipelineState: PipelineState = {
  allPapers: [],
  selectedPaperEntity: null,
  coaRawInput: DEFAULT_COA_INPUT,
  isParsingCoa: false,
  parsingMessage: '',
  pipelineStep: 1,
  pipelineStrain: 'Sour Diesel Acidic Cut',
  pipelineTHCa: 18.65,
  pipelineD9THC: 0.12,
  pipelineMoisture: 11.45,
  pipelineTemp: 120,
  pipelineDuration: 45,
  pipelineRatios: 'THCa, CBC, CBD',
  draftTemplateType: 'Academic Journal Paper',
  isDraftingPaper: false,
  draftedPaperData: null,
  isPaperPublished: false,
};

function pipelineReducer(
  state: PipelineState,
  action: PipelineAction
): PipelineState {
  switch (action.type) {
    case 'SET_ALL_PAPERS':
      return {
        ...state,
        allPapers: action.payload,
      };

    case 'ADD_PAPER':
      return {
        ...state,
        allPapers: [action.payload, ...state.allPapers],
      };

    case 'SET_SELECTED_PAPER':
      return {
        ...state,
        selectedPaperEntity: action.payload,
      };

    case 'SET_COA_RAW_INPUT':
      return {
        ...state,
        coaRawInput: action.payload,
      };

    case 'SET_IS_PARSING_COA':
      return {
        ...state,
        isParsingCoa: action.payload,
      };

    case 'SET_PARSING_MESSAGE':
      return {
        ...state,
        parsingMessage: action.payload,
      };

    case 'SET_PIPELINE_STEP':
      return {
        ...state,
        pipelineStep: action.payload,
      };

    case 'PATCH_PIPELINE_FIELDS':
      return {
        ...state,
        ...action.payload,
      };

    case 'SET_IS_DRAFTING_PAPER':
      return {
        ...state,
        isDraftingPaper: action.payload,
      };

    case 'SET_DRAFTED_PAPER_DATA':
      return {
        ...state,
        draftedPaperData: action.payload,
      };

    case 'SET_IS_PAPER_PUBLISHED':
      return {
        ...state,
        isPaperPublished: action.payload,
      };

    case 'LOAD_PARSED_COA':
      return {
        ...state,
        ...action.payload,
        pipelineStep: 2,
        parsingMessage: 'COA parsed successfully.',
      };

    case 'RESET_PIPELINE':
      return {
        ...initialPipelineState,
        allPapers: state.allPapers,
        selectedPaperEntity: state.selectedPaperEntity,
      };

    default:
      return state;
  }
}

type PipelineActions = {
  setAllPapers: React.Dispatch<React.SetStateAction<DocumentEntry[]>>;
  addPaper: (paper: DocumentEntry) => void;
  setSelectedPaperEntity: (paper: DocumentEntry | null) => void;
  setCoaRawInput: (value: string) => void;
  setIsParsingCoa: (value: boolean) => void;
  setParsingMessage: (value: string) => void;
  setPipelineStep: (step: PipelineStep) => void;
  setPipelineStrain: (value: string) => void;
  setPipelineTHCa: (value: number) => void;
  setPipelineD9THC: (value: number) => void;
  setPipelineMoisture: (value: number) => void;
  setPipelineTemp: (value: number) => void;
  setPipelineDuration: (value: number) => void;
  setPipelineRatios: (value: string) => void;
  setDraftTemplateType: (value: DraftTemplateType) => void;
  patchPipelineFields: (
    fields: Partial<Pick<
      PipelineState,
      | 'pipelineStrain'
      | 'pipelineTHCa'
      | 'pipelineD9THC'
      | 'pipelineMoisture'
      | 'pipelineTemp'
      | 'pipelineDuration'
      | 'pipelineRatios'
      | 'draftTemplateType'
    >>
  ) => void;
  loadParsedCoa: (
    fields: Partial<Pick<
      PipelineState,
      | 'pipelineStrain'
      | 'pipelineTHCa'
      | 'pipelineD9THC'
      | 'pipelineMoisture'
      | 'coaRawInput'
    >>
  ) => void;
  setIsDraftingPaper: (value: boolean) => void;
  setDraftedPaperData: (value: DraftedPaperData | null) => void;
  setIsPaperPublished: (value: boolean) => void;
  resetPipeline: () => void;
};

const PipelineStateContext = createContext<PipelineState | null>(null);
const PipelineActionsContext = createContext<PipelineActions | null>(null);

interface PipelineProviderProps {
  children: ReactNode;
  initialPapers?: DocumentEntry[];
  initialSelectedPaper?: DocumentEntry | null;
  allPapers?: DocumentEntry[];
  setAllPapers?: React.Dispatch<React.SetStateAction<DocumentEntry[]>>;
  selectedPaperEntity?: DocumentEntry | null;
  setSelectedPaperEntity?: React.Dispatch<React.SetStateAction<DocumentEntry | null>>;
}

export function PipelineProvider({
  children,
  initialPapers = [],
  initialSelectedPaper = null,
  setAllPapers: overrideSetAllPapers,
  setSelectedPaperEntity: overrideSetSelectedPaperEntity,
}: PipelineProviderProps) {
  const [state, dispatch] = useReducer(pipelineReducer, {
    ...initialPipelineState,
    allPapers: initialPapers,
    selectedPaperEntity: initialSelectedPaper,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const actions = useMemo<PipelineActions>(
    () => ({
      setAllPapers: (papersOrFn) => {
        if (overrideSetAllPapers) {
          overrideSetAllPapers(papersOrFn);
        } else {
          const newValue = typeof papersOrFn === 'function'
            ? papersOrFn(stateRef.current.allPapers)
            : papersOrFn;
          dispatch({ type: 'SET_ALL_PAPERS', payload: newValue });
        }
      },

      addPaper: (paper) =>
        dispatch({ type: 'ADD_PAPER', payload: paper }),

      setSelectedPaperEntity: (paper) => {
        if (overrideSetSelectedPaperEntity) {
          overrideSetSelectedPaperEntity(paper);
        } else {
          dispatch({ type: 'SET_SELECTED_PAPER', payload: paper });
        }
      },

      setCoaRawInput: (value) =>
        dispatch({ type: 'SET_COA_RAW_INPUT', payload: value }),

      setIsParsingCoa: (value) =>
        dispatch({ type: 'SET_IS_PARSING_COA', payload: value }),

      setParsingMessage: (value) =>
        dispatch({ type: 'SET_PARSING_MESSAGE', payload: value }),

      setPipelineStep: (step) =>
        dispatch({ type: 'SET_PIPELINE_STEP', payload: step }),

      setPipelineStrain: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineStrain: value } }),

      setPipelineTHCa: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineTHCa: value } }),

      setPipelineD9THC: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineD9THC: value } }),

      setPipelineMoisture: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineMoisture: value } }),

      setPipelineTemp: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineTemp: value } }),

      setPipelineDuration: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineDuration: value } }),

      setPipelineRatios: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { pipelineRatios: value } }),

      setDraftTemplateType: (value) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: { draftTemplateType: value } }),

      patchPipelineFields: (fields) =>
        dispatch({ type: 'PATCH_PIPELINE_FIELDS', payload: fields }),

      loadParsedCoa: (fields) =>
        dispatch({ type: 'LOAD_PARSED_COA', payload: fields }),

      setIsDraftingPaper: (value) =>
        dispatch({ type: 'SET_IS_DRAFTING_PAPER', payload: value }),

      setDraftedPaperData: (value) =>
        dispatch({ type: 'SET_DRAFTED_PAPER_DATA', payload: value }),

      setIsPaperPublished: (value) =>
        dispatch({ type: 'SET_IS_PAPER_PUBLISHED', payload: value }),

      resetPipeline: () =>
        dispatch({ type: 'RESET_PIPELINE' }),
    }),
    [overrideSetAllPapers, overrideSetSelectedPaperEntity]
  );

  return (
    <PipelineStateContext.Provider value={state}>
      <PipelineActionsContext.Provider value={actions}>
        {children}
      </PipelineActionsContext.Provider>
    </PipelineStateContext.Provider>
  );
}

export function usePipelineState() {
  const context = useContext(PipelineStateContext);
  if (!context) {
    throw new Error('usePipelineState must be used within a PipelineProvider');
  }
  return context;
}

export function usePipelineActions() {
  const context = useContext(PipelineActionsContext);
  if (!context) {
    throw new Error('usePipelineActions must be used within a PipelineProvider');
  }
  return context;
}

export function usePipeline() {
  return {
    ...usePipelineState(),
    ...usePipelineActions(),
  };
}
