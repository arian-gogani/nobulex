declare module '@nobulex/core' {
  export interface MerkleTree {
    readonly root: string;
    readonly leaves: readonly string[];
    readonly layers: readonly (readonly string[])[];
    readonly leafCount: number;
  }

  export interface InclusionProof {
    readonly leafIndex: number;
    readonly leafHash: string;
    readonly proof: readonly { readonly hash: string; readonly direction: 'left' | 'right' }[];
    readonly root: string;
  }

  export function buildMerkleTreeFromHashes(hashes: readonly string[]): MerkleTree;
  export function generateInclusionProof(tree: MerkleTree, leafIndex: number): InclusionProof;
  export function verifyInclusionProof(proof: InclusionProof): boolean;
}
