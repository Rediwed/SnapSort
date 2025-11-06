"""
performance_optimizations.py

High-performance optimizations for photo processing on fast SSDs.
"""

import os
import concurrent.futures
import threading
import mmap
import hashlib
from queue import Queue, Empty
from typing import Optional, Tuple, Dict, Any
from dataclasses import dataclass
from pathlib import Path


@dataclass
class FileTask:
    """Represents a file processing task."""
    src_path: str
    priority: int = 0  # Higher numbers = higher priority


class OptimizedPhotoProcessor:
    """Multi-threaded photo processor optimized for SSD performance."""
    
    def __init__(self, max_workers: int = None, batch_size: int = 50):
        # Auto-detect optimal thread count based on CPU cores
        if max_workers is None:
            max_workers = min(32, (os.cpu_count() or 1) + 4)
        
        self.max_workers = max_workers
        self.batch_size = batch_size
        
        # Separate thread pools for different operations
        self.io_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers, 
            thread_name_prefix="io"
        )
        self.cpu_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=os.cpu_count() or 1,
            thread_name_prefix="cpu"
        )
        
        # Queues for pipelining
        self.scan_queue = Queue(maxsize=batch_size * 2)
        self.process_queue = Queue(maxsize=batch_size)
        self.copy_queue = Queue(maxsize=batch_size // 2)
        
        self._shutdown = False
        
    def __enter__(self):
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()
        
    def shutdown(self):
        """Gracefully shutdown all thread pools."""
        self._shutdown = True
        self.io_executor.shutdown(wait=True)
        self.cpu_executor.shutdown(wait=True)


def compute_fast_hash(filepath: str, max_bytes: int = 8192) -> Optional[str]:
    """Optimized hash computation using memory mapping."""
    try:
        with open(filepath, 'rb') as f:
            file_size = os.path.getsize(filepath)
            
            # For small files, read directly
            if file_size <= max_bytes:
                return hashlib.sha256(f.read()).hexdigest()
            
            # For larger files, use memory mapping
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                # Hash first chunk + middle chunk + last chunk for better distribution
                hasher = hashlib.sha256()
                
                # First chunk
                chunk_size = max_bytes // 3
                hasher.update(mm[:chunk_size])
                
                # Middle chunk
                if file_size > chunk_size * 2:
                    mid_start = file_size // 2 - chunk_size // 2
                    hasher.update(mm[mid_start:mid_start + chunk_size])
                
                # Last chunk
                if file_size > chunk_size:
                    hasher.update(mm[-chunk_size:])
                
                return hasher.hexdigest()
                
    except Exception:
        return None


def batch_file_operations(file_paths: list, operation_func, max_workers: int = 8):
    """Execute file operations in parallel batches."""
    results = {}
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_path = {
            executor.submit(operation_func, path): path 
            for path in file_paths
        }
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_path):
            path = future_to_path[future]
            try:
                results[path] = future.result()
            except Exception as exc:
                results[path] = None
                
    return results


def optimized_file_scan(source_dir: str, supported_extensions: tuple) -> list:
    """Fast directory scanning with early filtering."""
    files = []
    supported_lower = tuple(ext.lower() for ext in supported_extensions)
    
    # Use os.scandir for better performance than os.walk
    def scan_recursive(path):
        try:
            with os.scandir(path) as entries:
                dirs_to_scan = []
                for entry in entries:
                    if entry.is_file(follow_symlinks=False):
                        if entry.name.lower().endswith(supported_lower):
                            files.append(entry.path)
                    elif entry.is_dir(follow_symlinks=False):
                        # Skip common system/cache directories early
                        dir_lower = entry.name.lower()
                        if not any(skip in dir_lower for skip in [
                            'cache', 'temp', 'tmp', 'system', 'windows',
                            'appdata', 'program files', 'recycler', '$recycle'
                        ]):
                            dirs_to_scan.append(entry.path)
                
                # Process subdirectories
                for dir_path in dirs_to_scan:
                    scan_recursive(dir_path)
                    
        except (OSError, PermissionError):
            pass  # Skip inaccessible directories
    
    scan_recursive(source_dir)
    return files


class AsyncFileProcessor:
    """Asynchronous file processing pipeline."""
    
    def __init__(self, processor_config: Dict[str, Any]):
        self.config = processor_config
        self.stats = {
            'scanned': 0,
            'processed': 0,
            'copied': 0,
            'skipped': 0,
            'errors': 0
        }
        
    async def process_file_async(self, src_path: str) -> Tuple[str, Optional[str]]:
        """Process a single file asynchronously."""
        # This would integrate with the existing photo_utils functions
        # but with async/await patterns for I/O operations
        pass


def create_memory_efficient_dedup_index():
    """Create a memory-efficient deduplication index for large datasets."""
    # Use memory mapping for large indices
    # Implement bloom filters for fast negative lookups
    # Consider using sqlite for persistence across runs
    pass


# Configuration for different storage types
STORAGE_OPTIMIZATIONS = {
    'nvme_gen4': {
        'max_workers': 16,
        'batch_size': 100,
        'hash_bytes': 16384,
        'concurrent_copies': 8,
        'enable_multithreading': True,
        'sequential_processing': False,
        'description': 'High-end NVMe Gen4 SSD'
    },
    'nvme_gen3': {
        'max_workers': 12,
        'batch_size': 75,
        'hash_bytes': 8192,
        'concurrent_copies': 6,
        'enable_multithreading': True,
        'sequential_processing': False,
        'description': 'NVMe Gen3 SSD'
    },
    'sata_ssd': {
        'max_workers': 8,
        'batch_size': 50,
        'hash_bytes': 4096,
        'concurrent_copies': 4,
        'enable_multithreading': True,
        'sequential_processing': False,
        'description': 'SATA SSD'
    },
    'hdd_7200rpm': {
        'max_workers': 1,
        'batch_size': 10,
        'hash_bytes': 4096,
        'concurrent_copies': 1,
        'enable_multithreading': False,
        'sequential_processing': True,
        'description': '7200 RPM HDD (optimized for sequential access)'
    },
    'hdd_5400rpm': {
        'max_workers': 1,
        'batch_size': 5,
        'hash_bytes': 2048,
        'concurrent_copies': 1,
        'enable_multithreading': False,
        'sequential_processing': True,
        'description': '5400 RPM HDD (slower mechanical drive)'
    },
    'usb_external': {
        'max_workers': 2,
        'batch_size': 15,
        'hash_bytes': 2048,
        'concurrent_copies': 1,
        'enable_multithreading': False,
        'sequential_processing': True,
        'description': 'External USB drive (conservative settings)'
    },
    'default': {
        'max_workers': 4,
        'batch_size': 25,
        'hash_bytes': 1024,
        'concurrent_copies': 2,
        'enable_multithreading': True,
        'sequential_processing': False,
        'description': 'Default conservative settings'
    }
}


def detect_storage_type(path: str) -> str:
    """Detect storage type to optimize settings."""
    import shutil
    import subprocess
    
    try:
        # Strategy 1: Check for NVMe devices first
        try:
            # Check for common NVMe device paths
            if os.path.exists('/dev/nvme0n1') or any(os.path.exists(f'/dev/nvme{i}n1') for i in range(5)):
                # We have NVMe - assume it's the primary storage
                return 'nvme_gen3'
        except Exception:
            pass
        
        # Strategy 2: Use df to get device and trace back to physical device
        try:
            result = subprocess.run(['df', path], capture_output=True, text=True)
            if result.returncode == 0:
                device = result.stdout.split('\n')[1].split()[0]
                
                # Handle LVM/mapper devices by finding underlying device
                if '/dev/mapper/' in device:
                    # Try to find the underlying physical device through LVM
                    try:
                        lvm_result = subprocess.run(['sudo', 'lvdisplay', device], 
                                                  capture_output=True, text=True)
                        if 'nvme' in lvm_result.stdout.lower():
                            return 'nvme_gen3'
                    except Exception:
                        pass
                    
                    # Alternative: check /sys/block for mapper devices
                    try:
                        mapper_name = device.split('/')[-1]
                        slaves_path = f'/sys/block/{mapper_name}/slaves'
                        if os.path.exists(slaves_path):
                            slaves = os.listdir(slaves_path)
                            for slave in slaves:
                                if 'nvme' in slave.lower():
                                    return 'nvme_gen3'
                                # Check if rotational
                                rot_path = f'/sys/block/{slave}/queue/rotational'
                                if os.path.exists(rot_path):
                                    with open(rot_path, 'r') as f:
                                        if f.read().strip() == '0':
                                            return 'sata_ssd'
                                        else:
                                            return 'hdd_7200rpm'
                    except Exception:
                        pass
                
                # Direct device check
                elif 'nvme' in device.lower():
                    return 'nvme_gen3'
                
                # Check if it's rotational for direct devices
                else:
                    device_name = device.split('/')[-1].rstrip('0123456789')
                    rotational_path = f'/sys/block/{device_name}/queue/rotational'
                    
                    if os.path.exists(rotational_path):
                        with open(rotational_path, 'r') as f:
                            is_rotational = f.read().strip() == '1'
                        
                        if is_rotational:
                            return 'hdd_7200rpm'
                        else:
                            return 'sata_ssd'
                
        except Exception:
            pass
        
        # Strategy 3: Check if it's likely an external drive
        if '/media/' in path or '/mnt/' in path or 'usb' in path.lower():
            return 'usb_external'
            
    except Exception:
        pass
    
    return 'default'


def get_optimal_settings(source_path: str) -> Dict[str, Any]:
    """Get optimal settings based on detected storage."""
    storage_type = detect_storage_type(source_path)
    return STORAGE_OPTIMIZATIONS.get(storage_type, STORAGE_OPTIMIZATIONS['default'])


# Better HDD configuration
ENABLE_FAST_HASH = True        # ✅ Still beneficial
FAST_HASH_BYTES = 4096        # ✅ Smaller chunks, less seeking  
ENABLE_MULTITHREADING = False  # ❌ Avoid for HDDs
SEQUENTIAL_PROCESSING = True   # ✅ Better for mechanical drives

# Example integration points for the main photo_organizer.py:

def optimized_scan_and_organize_photos(source_dir: str, dest_dir: str, **config):
    """Drop-in replacement for scan_and_organize_photos with optimizations."""
    
    # Get optimal settings
    settings = get_optimal_settings(source_dir)
    
    with OptimizedPhotoProcessor(
        max_workers=settings['max_workers'],
        batch_size=settings['batch_size']
    ) as processor:
        
        # Phase 1: Fast directory scan
        print("Fast scanning directories...", flush=True)
        file_list = optimized_file_scan(source_dir, config['supported_extensions'])
        print(f"Found {len(file_list)} potential files", flush=True)
        
        # Phase 2: Parallel processing pipeline
        # This would integrate with existing copy_photo_with_metadata
        # but process files in parallel batches
        
        pass  # Implementation continues...


def configure_for_storage_type(source_path: str) -> Dict[str, Any]:
    """
    Detect storage type and return optimal configuration for photo_organizer.py
    
    Returns a dict that can be used to set:
    - ENABLE_FAST_HASH
    - FAST_HASH_BYTES  
    - Threading settings (for future use)
    """
    settings = get_optimal_settings(source_path)
    storage_type = detect_storage_type(source_path)
    
    config = {
        'ENABLE_FAST_HASH': True,  # Always beneficial
        'FAST_HASH_BYTES': settings['hash_bytes'],
        'ENABLE_MULTITHREADING': settings['enable_multithreading'],
        'MAX_WORKERS': settings['max_workers'],
        'BATCH_SIZE': settings['batch_size'],
        'STORAGE_TYPE': storage_type,
        'DESCRIPTION': settings['description']
    }
    
    return config


def print_storage_recommendations(source_path: str):
    """Print storage-specific optimization recommendations."""
    config = configure_for_storage_type(source_path)
    
    print(f"\n🔍 Storage Analysis for: {source_path}")
    print(f"Detected: {config['DESCRIPTION']}")
    print(f"Storage type: {config['STORAGE_TYPE']}")
    
    print(f"\n⚙️  Recommended Settings:")
    print(f"ENABLE_FAST_HASH = {config['ENABLE_FAST_HASH']}")
    print(f"FAST_HASH_BYTES = {config['FAST_HASH_BYTES']}")
    print(f"Max workers: {config['MAX_WORKERS']}")
    print(f"Multithreading: {config['ENABLE_MULTITHREADING']}")
    
    # Storage-specific tips
    if 'hdd' in config['STORAGE_TYPE']:
        print(f"\n💡 HDD Optimization Tips:")
        print("• Sequential processing prevents head thrashing")
        print("• Smaller hash samples reduce seek time") 
        print("• Single-threaded avoids random access patterns")
        print("• Consider organizing by directory for better locality")
    elif 'nvme' in config['STORAGE_TYPE']:
        print(f"\n💡 NVMe SSD Tips:")
        print("• Large hash samples utilize high bandwidth")
        print("• Multi-threading maximizes parallel I/O")
        print("• Can handle aggressive concurrent operations")
    elif 'sata_ssd' in config['STORAGE_TYPE']:
        print(f"\n💡 SATA SSD Tips:")
        print("• Good balance of speed and concurrent operations")
        print("• Medium hash samples work well")
        print("• Moderate multi-threading beneficial")


if __name__ == "__main__":
    # Storage detection demo
    current_dir = "/home/dewicadat/dev/Projects/SnapSort"
    
    print("🚀 Storage Type Detection and Optimization")
    print("=" * 50)
    
    print_storage_recommendations(current_dir)
    
    # Performance testing
    import time
    
    # Benchmark different hash methods
    test_file = "/path/to/large/test/file.cr2"  # Example
    
    if os.path.exists(test_file):
        # Test standard hash
        start = time.time()
        standard_hash = hashlib.sha256()
        with open(test_file, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b""):
                standard_hash.update(chunk)
        standard_time = time.time() - start
        
        # Test optimized hash
        start = time.time()
        fast_hash = compute_fast_hash(test_file)
        fast_time = time.time() - start
        
        print(f"Standard hash: {standard_time:.3f}s")
        print(f"Fast hash: {fast_time:.3f}s")
        print(f"Speedup: {standard_time/fast_time:.1f}x")