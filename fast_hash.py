"""
fast_hash.py

Optimized hashing functions for fast SSDs and large files.
"""

import hashlib
import mmap
import os
from typing import Optional


def compute_smart_hash(filepath: str, max_bytes: int = 8192) -> Optional[str]:
    """
    Compute a fast hash using adaptive strategies based on file size.
    
    For SSDs, this is optimized to:
    1. Use memory mapping for large files
    2. Sample multiple parts of large files for better uniqueness
    3. Fall back to full reads for small files
    """
    try:
        file_size = os.path.getsize(filepath)
        
        # For very small files, just read everything
        if file_size <= max_bytes:
            with open(filepath, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        
        # For larger files, use memory mapping with sampling
        with open(filepath, 'rb') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                hasher = hashlib.sha256()
                
                # Strategy: Sample beginning, middle, and end
                # This gives better duplicate detection than just the beginning
                chunk_size = max_bytes // 3
                
                # Beginning
                hasher.update(mm[:chunk_size])
                
                # Middle (if file is large enough)
                if file_size > chunk_size * 6:  # Ensure we don't overlap
                    mid_start = (file_size // 2) - (chunk_size // 2)
                    hasher.update(mm[mid_start:mid_start + chunk_size])
                
                # End (if file is large enough)
                if file_size > chunk_size * 2:
                    hasher.update(mm[-chunk_size:])
                
                return hasher.hexdigest()
                
    except Exception:
        return None


def compute_progressive_hash(filepath: str, stages: list = None) -> dict:
    """
    Compute multiple hash levels for progressive duplicate detection.
    
    Returns hashes at different byte levels:
    - Quick hash (1KB): Fast initial comparison
    - Medium hash (8KB): Better accuracy for most photos
    - Deep hash (64KB): High accuracy for large RAW files
    """
    if stages is None:
        stages = [1024, 8192, 65536]  # 1KB, 8KB, 64KB
    
    results = {}
    
    try:
        file_size = os.path.getsize(filepath)
        
        with open(filepath, 'rb') as f:
            data_read = b''
            
            for i, max_bytes in enumerate(stages):
                if file_size <= max_bytes:
                    # Read remaining data and hash everything we have
                    remaining = f.read()
                    data_read += remaining
                    results[f'hash_{max_bytes}'] = hashlib.sha256(data_read).hexdigest()
                    break
                else:
                    # Read up to this stage
                    chunk = f.read(max_bytes - len(data_read))
                    data_read += chunk
                    results[f'hash_{max_bytes}'] = hashlib.sha256(data_read).hexdigest()
                    
    except Exception:
        pass
    
    return results


def fast_file_comparison(file1: str, file2: str, quick_check_bytes: int = 4096) -> bool:
    """
    Fast file comparison optimized for SSDs.
    
    Uses progressive comparison:
    1. Size check (instant)
    2. Quick hash of first few KB
    3. Full comparison only if needed
    """
    try:
        # Quick size check
        size1 = os.path.getsize(file1)
        size2 = os.path.getsize(file2)
        if size1 != size2:
            return False
        
        # For small files, just compare everything
        if size1 <= quick_check_bytes:
            with open(file1, 'rb') as f1, open(file2, 'rb') as f2:
                return f1.read() == f2.read()
        
        # Progressive comparison for larger files
        with open(file1, 'rb') as f1, open(file2, 'rb') as f2:
            # Check first chunk
            chunk1 = f1.read(quick_check_bytes)
            chunk2 = f2.read(quick_check_bytes)
            if chunk1 != chunk2:
                return False
            
            # If first chunk matches, check rest of file
            while True:
                chunk1 = f1.read(quick_check_bytes)
                chunk2 = f2.read(quick_check_bytes)
                
                if not chunk1 and not chunk2:  # Both EOF
                    return True
                if chunk1 != chunk2:
                    return False
                    
    except Exception:
        return False


class FastHashCache:
    """
    In-memory hash cache for frequently accessed files.
    Useful when processing the same directory multiple times.
    """
    
    def __init__(self, max_entries: int = 10000):
        self.cache = {}
        self.max_entries = max_entries
        self.access_count = {}
    
    def get_hash(self, filepath: str, hash_func=None) -> Optional[str]:
        """Get hash from cache or compute and cache it."""
        if hash_func is None:
            hash_func = compute_smart_hash
            
        try:
            # Check if file info matches cache
            stat_info = os.stat(filepath)
            cache_key = (filepath, stat_info.st_size, stat_info.st_mtime)
            
            if cache_key in self.cache:
                self.access_count[cache_key] = self.access_count.get(cache_key, 0) + 1
                return self.cache[cache_key]
            
            # Compute hash and cache it
            file_hash = hash_func(filepath)
            if file_hash:
                # Evict least recently used if cache is full
                if len(self.cache) >= self.max_entries:
                    lru_key = min(self.access_count.items(), key=lambda x: x[1])[0]
                    del self.cache[lru_key]
                    del self.access_count[lru_key]
                
                self.cache[cache_key] = file_hash
                self.access_count[cache_key] = 1
            
            return file_hash
            
        except Exception:
            return None
    
    def clear(self):
        """Clear the cache."""
        self.cache.clear()
        self.access_count.clear()
    
    def stats(self) -> dict:
        """Get cache statistics."""
        return {
            'entries': len(self.cache),
            'max_entries': self.max_entries,
            'total_accesses': sum(self.access_count.values())
        }


# Optimized hash functions for different use cases
def photo_hash_quick(filepath: str) -> Optional[str]:
    """Quick hash for initial duplicate screening (1KB)."""
    return compute_smart_hash(filepath, max_bytes=1024)


def photo_hash_standard(filepath: str) -> Optional[str]:
    """Standard hash for most photo files (8KB)."""
    return compute_smart_hash(filepath, max_bytes=8192)


def photo_hash_thorough(filepath: str) -> Optional[str]:
    """Thorough hash for large RAW files (64KB)."""
    return compute_smart_hash(filepath, max_bytes=65536)


if __name__ == "__main__":
    # Benchmark different hashing approaches
    import time
    import tempfile
    
    def benchmark_hash_methods():
        """Benchmark hash methods on different file sizes."""
        # Create test files
        test_sizes = [1024, 10*1024, 100*1024, 1024*1024, 10*1024*1024]  # 1KB to 10MB
        
        for size in test_sizes:
            # Create test file
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp.write(os.urandom(size))
                test_file = tmp.name
            
            try:
                print(f"\nTesting {size/1024:.0f}KB file:")
                
                # Test standard hash
                start = time.time()
                standard = hashlib.sha256()
                with open(test_file, 'rb') as f:
                    for chunk in iter(lambda: f.read(65536), b""):
                        standard.update(chunk)
                standard_time = time.time() - start
                
                # Test smart hash
                start = time.time()
                smart = compute_smart_hash(test_file)
                smart_time = time.time() - start
                
                # Test quick hash
                start = time.time()
                quick = photo_hash_quick(test_file)
                quick_time = time.time() - start
                
                print(f"  Standard: {standard_time*1000:.1f}ms")
                print(f"  Smart:    {smart_time*1000:.1f}ms ({standard_time/smart_time:.1f}x faster)")
                print(f"  Quick:    {quick_time*1000:.1f}ms ({standard_time/quick_time:.1f}x faster)")
                
            finally:
                os.unlink(test_file)
    
    # Run benchmark if called directly
    print("Benchmarking hash methods...")
    benchmark_hash_methods()