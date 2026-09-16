const API = '/api';
const grid = document.querySelector('#projectGrid');
const engineList = document.querySelector('#engineList');
const activeCount = document.querySelector('#activeCount');
const worldsCount = document.querySelector('#worldsCount');
const dialog = document.querySelector('#storyDialog');
const form = document.querySelector('#storyForm');

const statusLabel = (value) => ({story_bible:'Story Bible',episode_plan:'Episode Plan',production:'Production',complete:'Complete',draft:'Draft'}[value] || value);
const scopeLabel = (p) => p.primary_audience || ({global:'Global Christian audience',regional:'Regional audience',local:'Local / community audience'}[p.audience_scope] || 'Global audience');
const timeAgo = (date) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff/60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return `${hrs} hr${hrs===1?'':'s'} ago`;
  const days = Math.floor(hrs/24);
  return `${days} day${days===1?'':'s'} ago`;
};

function renderProjects(projects){
  activeCount.textContent = String(projects.filter(p=>p.status!=='complete').length).padStart(2,'0');
  worldsCount.textContent = String(projects.filter(p=>p.setting).length).padStart(2,'0');
  if(!projects.length){grid.innerHTML='<div class="empty">No stories yet. Start the first PARABLE production.</div>';return;}
  grid.innerHTML = projects.map(p=>`<article class="project-card">
    <div class="card-top"><span>${statusLabel(p.status)}</span><span>${timeAgo(p.updated_at)}</span></div>
    <h3>${escapeHtml(p.title)}</h3>
    <p>${escapeHtml(p.logline || 'New story waiting for its first creative analysis.')}</p>
    <div class="meta"><span>⌖ ${escapeHtml(p.setting || 'Not grounded yet')}</span><span>◉ ${escapeHtml(scopeLabel(p))}</span></div>
    <div class="progress"><span style="width:${Number(p.progress)||0}%"></span></div>
    <div class="card-foot"><span>${Number(p.progress)||0}% developed</span><b>Open story →</b></div>
  </article>`).join('');
}

function renderEngines(engines){
  engineList.innerHTML = engines.map(e=>`<div class="engine-row"><span>${escapeHtml(e.display_name)}</span><span>${escapeHtml(e.status)}</span></div>`).join('');
}

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));}

async function load(){
  try{
    const [projectRes, engineRes] = await Promise.all([fetch(`${API}/projects`),fetch(`${API}/engines`)]);
    if(!projectRes.ok) throw new Error('Could not load projects');
    renderProjects(await projectRes.json());
    if(engineRes.ok) renderEngines(await engineRes.json());
  }catch(err){grid.innerHTML=`<div class="empty">${escapeHtml(err.message)}. Refresh to retry.</div>`;}
}

document.querySelector('#newStoryBtn').addEventListener('click',()=>dialog.showModal());
document.querySelector('#closeDialog').addEventListener('click',()=>dialog.close());
document.querySelector('#cancelDialog').addEventListener('click',()=>dialog.close());
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;submit.textContent='Creating…';
  const data=Object.fromEntries(new FormData(form).entries());
  try{
    const response=await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body=await response.json();
    if(!response.ok) throw new Error(body.error || 'Could not create project');
    form.reset();dialog.close();await load();
  }catch(err){alert(err.message)}finally{submit.disabled=false;submit.textContent='Create project';}
});

load();
